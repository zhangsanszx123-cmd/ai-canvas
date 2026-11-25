import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb } from "./db";
import { HttpError } from "./http";
import {
  activeStates,
  AGENT_IMAGE_MODEL,
  defaultConfig,
  dimensions,
  type GenerationInput,
} from "./models";

export async function transaction<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await getDb().connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function projectFor(owner: string, id: string) {
  const { rows } = await getDb().query(
    "SELECT * FROM ac_projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
    [id, owner],
  );
  if (!rows[0]) throw new HttpError(404, "项目不存在");
  return rows[0];
}
export async function rateLimit(key: string, max: number, seconds = 60) {
  const { rows } = await getDb().query(
    "INSERT INTO ac_rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ac_rate_limits.expires_at<now() THEN 1 ELSE ac_rate_limits.count+1 END, expires_at=CASE WHEN ac_rate_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE ac_rate_limits.expires_at END RETURNING count",
    [key, seconds],
  );
  if (rows[0].count > max) throw new HttpError(429, "操作太频繁，请稍后重试");
}
export async function enqueue(
  db: PoolClient,
  owner: string,
  project: string,
  input: GenerationInput,
  key: string,
  batchId?: string,
) {
  if (!/^[\w-]{8,128}$/.test(key))
    throw new HttpError(422, "缺少有效的请求标识");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [owner]);
  const allowedProject = await db.query(
    "SELECT id FROM ac_projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
    [project, owner],
  );
  if (!allowedProject.rowCount) throw new HttpError(404, "项目不存在");
  const hash = createHash("sha256")
    .update(JSON.stringify({ project, ...input }))
    .digest("hex");
  const existing = await db.query(
    "SELECT * FROM ac_tasks WHERE owner_id=$1 AND idempotency_key=$2",
    [owner, key],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].request_hash !== hash)
      throw new HttpError(409, "请求标识已用于其他内容");
    return existing.rows[0];
  }
  const active = await db.query(
    "SELECT project_id,batch_id FROM ac_tasks WHERE owner_id=$1 AND status=ANY($2::text[])",
    [owner, activeStates],
  );
  if (
    active.rows.some(
      (r) => r.project_id === project && (!batchId || r.batch_id !== batchId),
    )
  )
    throw new HttpError(409, "此项目有正在处理的生成任务");
  if (
    !active.rows.some((r) => r.project_id === project) &&
    new Set(active.rows.map((r) => r.project_id)).size >= 2
  )
    throw new HttpError(429, "最多同时生成两个项目，请等待现有任务完成");
  const references = input.referenceAssetIds?.length
    ? input.referenceAssetIds
    : input.referenceAssetId
      ? [input.referenceAssetId]
      : [];
  for (const referenceId of references) {
    const ref = await db.query(
      "SELECT * FROM ac_assets WHERE id=$1 AND owner_id=$2 AND project_id=$3",
      [referenceId, owner, project],
    );
    if (!ref.rows[0]) throw new HttpError(404, "参考图不可用");
    if (!ref.rows[0].mime.startsWith("image/"))
      throw new HttpError(422, "参考素材必须是图片");
    if (ref.rows[0].bytes > 10_000_000)
      throw new HttpError(413, "参考图不能超过 10MB");
  }
  const attachmentIds = input.attachmentIds || references;
  for (const attachmentId of attachmentIds) {
    const attachment = await db.query(
      "SELECT id FROM ac_assets WHERE id=$1 AND owner_id=$2 AND project_id=$3",
      [attachmentId, owner, project],
    );
    if (!attachment.rowCount) throw new HttpError(404, "附件不可用");
  }
  const id = randomUUID();
  const size = dimensions(input.config) || [1024, 1024];
  const height = Math.min(600, Math.max(120, (480 * size[1]) / size[0]));
  const last = await db.query(
    "SELECT COALESCE(MAX(y+height),48)+32 AS y FROM ac_nodes WHERE project_id=$1",
    [project],
  );
  const { rows } = await db.query(
    "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,reference_asset_id,config,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [
      id,
      project,
      owner,
      input.prompt,
      input.referenceAssetId || null,
      input.config,
      key,
      hash,
    ],
  );
  await db.query("UPDATE ac_tasks SET reference_asset_ids=$2 WHERE id=$1", [
    id,
    JSON.stringify(references),
  ]);
  if (batchId)
    await db.query("UPDATE ac_tasks SET batch_id=$2 WHERE id=$1", [
      id,
      batchId,
    ]);
  await db.query("UPDATE ac_tasks SET attachment_ids=$2 WHERE id=$1", [
    id,
    JSON.stringify(attachmentIds),
  ]);
  rows[0].reference_asset_ids = references;
  rows[0].attachment_ids = attachmentIds;
  await db.query(
    "INSERT INTO ac_nodes(id,project_id,task_id,y,height) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), project, id, last.rows[0].y, height],
  );
  if (input.config.model !== AGENT_IMAGE_MODEL)
    await db.query(
      "UPDATE ac_projects SET config=$1,updated_at=now() WHERE id=$2",
      [input.config, project],
    );
  return rows[0];
}
export async function createProject(
  owner: string,
  input?: GenerationInput,
  key?: string,
) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [owner]);
    if (input && key) {
      const old = await db.query(
        "SELECT project_id,prompt,reference_asset_id,config FROM ac_tasks WHERE owner_id=$1 AND idempotency_key=$2",
        [owner, key],
      );
      if (old.rows[0]) {
        const row = old.rows[0];
        if (
          row.prompt !== input.prompt ||
          row.reference_asset_id !== (input.referenceAssetId || null) ||
          Object.keys(input.config).some(
            (k) =>
              row.config[k] !== input.config[k as keyof typeof input.config],
          )
        )
          throw new HttpError(409, "请求标识已用于其他内容");
        return { id: row.project_id };
      }
    }
    const id = randomUUID();
    await db.query(
      "INSERT INTO ac_projects(id,owner_id,name,config) VALUES($1,$2,$3,$4)",
      [
        id,
        owner,
        input?.prompt.slice(0, 20) || "未命名项目",
        input?.config || defaultConfig,
      ],
    );
    const pendingAttachments = [
      ...new Set([
        ...(input?.attachmentIds || []),
        ...(input?.referenceAssetIds || []),
        ...(input?.referenceAssetId ? [input.referenceAssetId] : []),
      ]),
    ];
    for (const attachmentId of pendingAttachments) {
      const ref = await db.query(
        "UPDATE ac_assets SET project_id=$1 WHERE id=$2 AND owner_id=$3 AND project_id IS NULL RETURNING id",
        [id, attachmentId, owner],
      );
      if (!ref.rowCount) throw new HttpError(404, "参考图不可用，请重新上传");
    }
    if (input) await enqueue(db, owner, id, input, key || "");
    return { id };
  });
}
