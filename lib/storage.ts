import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { getDb } from "./db";
import { HttpError } from "./http";

export const MAX_IMAGE_BYTES = 10_000_000;
let s3: S3Client | undefined;
const previewSignatures = new Map<string, { url: string; until: number }>();
function client() {
  if (
    !process.env.S3_ENDPOINT ||
    !process.env.S3_ACCESS_KEY ||
    !process.env.S3_SECRET_KEY ||
    !process.env.S3_BUCKET
  )
    throw new HttpError(503, "图片存储尚未配置");
  return (s3 ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "auto",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      ...(process.env.S3_SESSION_TOKEN
        ? { sessionToken: process.env.S3_SESSION_TOKEN }
        : {}),
    },
  }));
}
export async function imageInfo(buffer: Buffer, max = MAX_IMAGE_BYTES) {
  if (buffer.byteLength > max)
    throw new HttpError(413, "图片大小不能超过 10MB");
  const meta = await sharp(buffer, {
    limitInputPixels: 100_000_000,
    animated: false,
  })
    .metadata()
    .catch(() => {
      throw new HttpError(422, "无法读取图片，请使用 PNG、JPEG 或 WebP");
    });
  if (
    !meta.width ||
    !meta.height ||
    !["jpeg", "png", "webp"].includes(meta.format || "") ||
    (meta.pages || 1) > 1
  )
    throw new HttpError(422, "仅支持静态 PNG、JPEG、WebP 图片");
  return {
    width: meta.autoOrient.width,
    height: meta.autoOrient.height,
    mime: `image/${meta.format}`,
    ext: meta.format!,
  };
}
export async function putAsset(
  owner: string,
  project: string | null,
  bytes: Buffer,
  source = "upload",
) {
  const info = await imageInfo(
    bytes,
    source === "generated" ? 50_000_000 : MAX_IMAGE_BYTES,
  );
  const id = crypto.randomUUID();
  const key = `${owner}/${project || "pending"}/${id}.${info.ext}`;
  const previewKey = `${key}.preview.webp`;
  const preview = await createImagePreview(bytes);
  try {
    const uploads = await Promise.allSettled([
      uploadImage(key, bytes, info.mime),
      uploadImage(previewKey, preview, "image/webp"),
    ]);
    const failed = uploads.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  } catch (error) {
    await deleteObject(key).catch(() => {});
    throw error;
  }
  try {
    await getDb().query(
      "INSERT INTO ac_assets(id,owner_id,project_id,object_key,mime,width,height,bytes,source,preview_object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        owner,
        project,
        key,
        info.mime,
        info.width,
        info.height,
        bytes.length,
        source,
        previewKey,
      ],
    );
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  return { id, ...info, bytes: bytes.length, url: await signKey(key) };
}
export async function signKey(key: string, expiresIn = 3600, download = false) {
  // Reuse preview signatures briefly so repeated views can use the browser's
  // image cache. Callers still recheck authorization before every redirect.
  const cacheKey = `${expiresIn}:${key}`;
  const cacheable =
    key.endsWith(".preview.webp") && !download && expiresIn >= 120;
  const cached = cacheable ? previewSignatures.get(cacheKey) : undefined;
  if (cached && cached.until > Date.now()) return cached.url;
  const ext =
    key
      .split(".")
      .at(-1)
      ?.replace(/[^a-z]/g, "") || "png";
  const url = await getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ...(download
        ? {
            ResponseContentDisposition: `attachment; filename="ai-canvas.${ext}"`,
          }
        : {}),
    }),
    { expiresIn },
  );
  if (cacheable) {
    if (previewSignatures.size >= 500)
      previewSignatures.delete(previewSignatures.keys().next().value!);
    previewSignatures.set(cacheKey, { url, until: Date.now() + 60_000 });
  }
  return url;
}
export async function assetUrl(
  id: string,
  owner: string,
  expiresIn = 3600,
  download = false,
  preview = false,
) {
  const { rows } = await getDb().query(
    "SELECT a.object_key,a.preview_object_key FROM ac_assets a WHERE a.id=$1 AND a.owner_id=$2 AND (a.project_id IS NULL OR EXISTS(SELECT 1 FROM ac_projects p WHERE p.id=a.project_id AND p.owner_id=$2 AND p.deleted_at IS NULL))",
    [id, owner],
  );
  if (!rows[0]) throw new HttpError(404, "图片不存在");
  return signKey(
    preview && !download
      ? rows[0].preview_object_key || rows[0].object_key
      : rows[0].object_key,
    expiresIn,
    download,
  );
}
export async function deleteObject(key: string) {
  return Promise.all(
    [
      key,
      ...(/\.(png|jpeg|webp)$/.test(key) ? [`${key}.preview.webp`] : []),
    ].map((objectKey) =>
      client().send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: objectKey,
        }),
      ),
    ),
  );
}

export async function readAsset(id: string, owner: string, project: string) {
  const { rows } = await getDb().query(
    "SELECT a.* FROM ac_assets a JOIN ac_projects p ON p.id=a.project_id WHERE a.id=$1 AND a.owner_id=$2 AND a.project_id=$3 AND p.owner_id=$2 AND p.deleted_at IS NULL",
    [id, owner, project],
  );
  const asset = rows[0];
  if (!asset) throw new HttpError(404, "素材不存在");
  const result = await client().send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: asset.object_key,
    }),
  );
  if (!result.Body) throw new HttpError(404, "素材不可读");
  return {
    asset,
    bytes: Buffer.from(await result.Body.transformToByteArray()),
  };
}

export async function putMarkdown(
  owner: string,
  project: string | null,
  bytes: Buffer,
  filename: string,
) {
  if (bytes.length > 1_000_000)
    throw new HttpError(413, "Markdown 不能超过 1MB");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(422, "Markdown 必须使用 UTF-8 编码");
  }
  if (bytes.includes(0)) throw new HttpError(422, "不能上传二进制文件");
  const id = crypto.randomUUID();
  const key = `${owner}/${project || "pending"}/${id}.md`;
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: "text/markdown; charset=utf-8",
      ContentDisposition: "attachment",
    }),
  );
  try {
    await getDb().query(
      "INSERT INTO ac_assets(id,owner_id,project_id,object_key,mime,width,height,bytes,source,filename) VALUES($1,$2,$3,$4,'text/markdown',0,0,$5,'upload',$6)",
      [id, owner, project, key, bytes.length, filename.slice(0, 255)],
    );
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  return {
    id,
    mime: "text/markdown",
    filename: filename.slice(0, 255),
    width: 0,
    height: 0,
    bytes: bytes.length,
  };
}

export async function placeAsset(
  owner: string,
  project: string,
  assetId: string,
  x = 80,
  y?: number,
) {
  const { rows } = await getDb().query(
    "SELECT a.width,a.height FROM ac_assets a JOIN ac_projects p ON p.id=a.project_id WHERE a.id=$1 AND a.owner_id=$2 AND a.project_id=$3 AND p.owner_id=$2 AND p.deleted_at IS NULL AND a.mime LIKE 'image/%'",
    [assetId, owner, project],
  );
  if (!rows[0]) throw new HttpError(404, "图片不存在");
  const id = crypto.randomUUID();
  const width = Math.min(480, rows[0].width);
  const placementY =
    y ??
    (
      await getDb().query(
        "SELECT COALESCE(MAX(y+height),48)+32 AS y FROM ac_nodes WHERE project_id=$1",
        [project],
      )
    ).rows[0].y;
  await getDb().query(
    "INSERT INTO ac_nodes(id,project_id,asset_id,x,y,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      project,
      assetId,
      x,
      placementY,
      width,
      (width * rows[0].height) / rows[0].width,
    ],
  );
  return { id, assetId };
}

export async function createImagePreview(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer();
}
async function uploadImage(key: string, bytes: Buffer, mime: string) {
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: "private, max-age=86400, immutable",
    }),
  );
}

// Backfill only derived files; original objects and canvas geometry are untouched.
export async function backfillImagePreview(id: string) {
  const { rows } = await getDb().query(
    "SELECT object_key,preview_object_key FROM ac_assets WHERE id=$1 AND mime IN ('image/png','image/jpeg','image/webp')",
    [id],
  );
  const asset = rows[0];
  if (!asset || asset.preview_object_key) return null;
  const object = await client().send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: asset.object_key,
    }),
  );
  if (!object.Body) throw new Error("图片不可读");
  const bytes = Buffer.from(await object.Body.transformToByteArray());
  const preview = await createImagePreview(bytes);
  const key = `${asset.object_key}.preview.webp`;
  await uploadImage(key, preview, "image/webp");
  await getDb().query(
    "UPDATE ac_assets SET preview_object_key=$2 WHERE id=$1 AND object_key=$3 AND preview_object_key IS NULL",
    [id, key, asset.object_key],
  );
  return { originalBytes: bytes.length, previewBytes: preview.length };
}
