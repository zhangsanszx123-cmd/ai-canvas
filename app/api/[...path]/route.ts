import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { checkOrigin, respond, HttpError, uuid } from "@/lib/http";
import { configSchema, generationSchema } from "@/lib/models";
import {
  createProject,
  projectFor,
  transaction,
  enqueue,
  rateLimit,
} from "@/lib/repository";
import {
  putAsset,
  putMarkdown,
  placeAsset,
  readAsset,
  assetUrl,
} from "@/lib/storage";
import { mailReady } from "@/lib/mail";
import { agentInput, runAgent } from "@/lib/agent";
import { parseSkill, skillFor } from "@/lib/skills";

type Context = { params: Promise<{ path: string[] }> };
function publicTask(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    prompt: row.prompt,
    referenceAssetId: row.reference_asset_id,
    referenceAssetIds: row.reference_asset_ids,
    attachmentIds: row.attachment_ids,
    config: row.config,
    status: row.status,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    results: (row.results as { assetId?: string }[])
      .filter((r) => r.assetId)
      .map((r) => ({
        assetId: r.assetId,
        url: `/api/assets/${r.assetId}/content`,
      })),
  };
}
async function dispatch(request: Request, context: Context) {
  const { path } = await context.params;
  const method = request.method;
  const db = getDb();
  const url = new URL(request.url);
  if (method === "GET" && path.join("/") === "config")
    return { mailReady: mailReady() };
  if (method !== "GET") checkOrigin(request);
  const user = await requireUser();
  const owner = user.id;
  if (method !== "GET") await rateLimit(`${owner}:writes`, 60);
  if (method !== "GET" && request.body) {
    const limit = path[0] === "uploads" ? 10_100_000 : 200_000;
    if (Number(request.headers.get("content-length")) > limit)
      throw new HttpError(413, "请求内容过大");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, "请求内容过大");
      }
      chunks.push(value);
    }
    request = new Request(request.url, {
      method,
      headers: request.headers,
      body: new Uint8Array(Buffer.concat(chunks)),
    });
  }
  if (method === "POST" && path[0] === "uploads" && path.length === 1) {
    if (Number(request.headers.get("content-length")) > 10_100_000)
      throw new HttpError(413, "图片不能超过 10MB");
    await rateLimit(`${owner}:uploads`, 10);
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) throw new HttpError(422, "请选择图片");
    if (file.size > 10_000_000) throw new HttpError(413, "图片不能超过 10MB");
    const projectId = data.get("projectId");
    if (projectId) await projectFor(owner, uuid(String(projectId)));
    const bytes = Buffer.from(await file.arrayBuffer());
    const markdown = /\.(md|markdown)$/i.test(file.name);
    const asset = markdown
      ? await putMarkdown(
          owner,
          projectId ? String(projectId) : null,
          bytes,
          file.name,
        )
      : await putAsset(owner, projectId ? String(projectId) : null, bytes);
    if (!markdown) {
      await db.query(
        "UPDATE ac_assets SET filename=$2 WHERE id=$1 AND owner_id=$3",
        [asset.id, file.name.slice(0, 255), owner],
      );
      if (projectId) await placeAsset(owner, String(projectId), asset.id);
    }
    return { ...asset, url: `/api/assets/${asset.id}/content` };
  }
  if (path[0] === "assets" && path[1] && method === "GET") {
    const id = uuid(path[1]);
    if (path[2] === "content")
      return NextResponse.redirect(
        await assetUrl(
          id,
          owner,
          3600,
          url.searchParams.get("download") === "1",
        ),
        { status: 307, headers: { "Cache-Control": "private, no-store" } },
      );
    if (path[2] === "url")
      return { url: await assetUrl(id, owner), expiresIn: 3600 };
  }
  if (path[0] === "projects" && path.length === 1) {
    if (method === "POST") {
      const raw = await request.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new HttpError(422, "请求格式不正确");
      const input =
        raw.prompt !== undefined ? generationSchema.parse(raw) : undefined;
      await rateLimit(`${owner}:projects`, 15);
      return createProject(
        owner,
        input,
        request.headers.get("idempotency-key") || undefined,
      );
    }
    if (method === "GET") {
      const limit = Math.min(
        20,
        Math.max(1, Number(url.searchParams.get("limit")) || 20),
      );
      let cursor: { time: string; id: string } | null = null;
      if (url.searchParams.get("cursor")) {
        try {
          cursor = JSON.parse(
            Buffer.from(
              url.searchParams.get("cursor")!,
              "base64url",
            ).toString(),
          );
          if (
            !cursor?.time ||
            !cursor.id ||
            Number.isNaN(Date.parse(cursor.time))
          )
            throw new Error();
          uuid(cursor.id);
        } catch {
          throw new HttpError(422, "分页参数无效");
        }
      }
      const { rows } = await db.query(
        "SELECT id,name,cover_asset_id,created_at,updated_at FROM ac_projects WHERE owner_id=$1 AND ($2::timestamptz IS NULL OR (updated_at,id)<($2::timestamptz,$3::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $4",
        [owner, cursor?.time || null, cursor?.id || null, limit + 1],
      );
      const more = rows.length > limit;
      const items = rows.slice(0, limit).map((r) => ({
        ...r,
        coverUrl: r.cover_asset_id
          ? `/api/assets/${r.cover_asset_id}/content`
          : null,
      }));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          more && last
            ? Buffer.from(
                JSON.stringify({
                  time: last.updated_at.toISOString(),
                  id: last.id,
                }),
              ).toString("base64url")
            : null,
      };
    }
  }
  if (path[0] === "projects" && path[1]) {
    const id = uuid(path[1]);
    const project = await projectFor(owner, id);
    if (path[2] === "skills") {
      if (path.length === 3 && method === "GET")
        return {
          items: (
            await db.query(
              "SELECT id,name,description,created_at FROM ac_skills WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC",
              [owner, id],
            )
          ).rows,
        };
      if (path.length === 3 && method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !/^SKILL\.md$/i.test(file.name))
          throw new HttpError(422, "请上传标准 SKILL.md 文件");
        if (file.size > 128000)
          throw new HttpError(413, "Skill 不能超过 128KB");
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(
            await file.arrayBuffer(),
          );
        } catch {
          throw new HttpError(422, "Skill 必须为 UTF-8 编码");
        }
        const skill = parseSkill(text);
        const saved = await db.query(
          "INSERT INTO ac_skills(id,owner_id,project_id,name,description,source,body) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,project_id,name) DO NOTHING RETURNING id,name,description",
          [
            crypto.randomUUID(),
            owner,
            id,
            skill.name,
            skill.description,
            skill.source,
            skill.body,
          ],
        );
        if (!saved.rowCount)
          throw new HttpError(409, "此项目已存在同名技能，请先移除旧版");
        return saved.rows[0];
      }
      if (path.length === 4) {
        const skill = await skillFor(owner, id, uuid(path[3]));
        if (method === "GET") return skill;
        if (method === "DELETE") {
          await db.query(
            "DELETE FROM ac_skills WHERE id=$1 AND owner_id=$2 AND project_id=$3",
            [skill.id, owner, id],
          );
          return { ok: true };
        }
      }
    }
    if (path.length === 3 && path[2] === "agent" && method === "GET")
      return {
        messages: (project.agent_messages || []).map(
          (run: {
            id: string;
            prompt: string;
            attachmentIds: string[];
            createdAt: string;
            events: unknown[];
            skillNames?: string[];
          }) => ({
            id: run.id,
            prompt: run.prompt,
            attachmentIds: run.attachmentIds,
            createdAt: run.createdAt,
            events: run.events,
            skillNames: run.skillNames || [],
          }),
        ),
      };
    if (path.length === 3 && path[2] === "agent" && method === "POST") {
      await rateLimit(`${owner}:agent`, 10);
      const input = agentInput.parse(await request.json());
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 300_000);
      request.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
      const stream = new ReadableStream({
        async start(controller) {
          let closed = false;
          const emit = (event: unknown) => {
            if (!closed) {
              try {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(event) + "\n"),
                );
              } catch {
                closed = true;
                abort.abort();
              }
            }
          };
          try {
            await runAgent(owner, id, input, emit, abort.signal);
          } catch {
            emit({
              type: "error",
              message: "Agent 暂时无法处理请求，请稍后重试",
            });
          } finally {
            clearTimeout(timer);
            if (!closed) controller.close();
          }
        },
        cancel() {
          abort.abort();
          clearTimeout(timer);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (path.length === 3 && path[2] === "nodes" && method === "POST") {
      const body = z
        .object({
          assetId: z.string().uuid(),
          x: z.number().finite().optional(),
          y: z.number().finite().optional(),
        })
        .parse(await request.json());
      return placeAsset(owner, id, body.assetId, body.x, body.y);
    }
    if (
      path.length === 5 &&
      path[2] === "attachments" &&
      path[4] === "text" &&
      method === "GET"
    ) {
      const { asset, bytes } = await readAsset(uuid(path[3]), owner, id);
      if (asset.mime !== "text/markdown")
        throw new HttpError(422, "附件不是 Markdown");
      return { text: bytes.toString("utf8"), filename: asset.filename };
    }
    if (path.length === 4 && path[2] === "nodes" && method === "DELETE") {
      const nodeId = uuid(path[3]);
      return transaction(async (tx) => {
        const removed = await tx.query(
          "DELETE FROM ac_nodes n WHERE n.id=$1 AND n.project_id=$2 AND EXISTS(SELECT 1 FROM ac_projects p WHERE p.id=n.project_id AND p.owner_id=$3) AND (n.asset_id IS NOT NULL OR EXISTS(SELECT 1 FROM ac_tasks t WHERE t.id=n.task_id AND t.status='failed')) RETURNING n.id",
          [nodeId, id, owner],
        );
        if (!removed.rowCount) {
          const existing = await tx.query(
            "SELECT id FROM ac_nodes WHERE id=$1 AND project_id=$2",
            [nodeId, id],
          );
          throw new HttpError(
            existing.rowCount ? 409 : 404,
            existing.rowCount
              ? "只能删除已明确失败的空白占位"
              : "画布节点不存在",
          );
        }
        await tx.query(
          "UPDATE ac_projects SET updated_at=now() WHERE id=$1 AND owner_id=$2",
          [id, owner],
        );
        return { ok: true };
      });
    }
    if (path.length === 2 && method === "GET") {
      const [tasks, nodes, assets, health] = await Promise.all([
        db.query(
          "SELECT * FROM ac_tasks WHERE project_id=$1 ORDER BY created_at",
          [id],
        ),
        db.query(
          "SELECT n.*,COALESCE(t.status,'completed') AS status,t.progress,t.error FROM ac_nodes n LEFT JOIN ac_tasks t ON n.task_id=t.id WHERE n.project_id=$1 ORDER BY t.created_at NULLS LAST,n.result_index",
          [id],
        ),
        db.query(
          "SELECT id,mime,width,height,bytes,filename FROM ac_assets WHERE project_id=$1",
          [id],
        ),
        db.query(
          "SELECT 1 FROM ac_worker_health WHERE id='main' AND heartbeat>now()-interval '5 minutes'",
        ),
      ]);
      return {
        project: {
          id: project.id,
          name: project.name,
          config: project.config,
          viewport: project.viewport,
          version: project.version,
          agent_lease_until: project.agent_lease_until,
        },
        tasks: tasks.rows.map(publicTask),
        nodes: nodes.rows.map((n) => ({
          ...n,
          url: n.asset_id ? `/api/assets/${n.asset_id}/content` : null,
        })),
        assets: assets.rows.map((a) => ({
          ...a,
          url: `/api/assets/${a.id}/content`,
        })),
        workerOnline: !!health.rowCount,
      };
    }
    if (path.length === 2 && method === "PATCH") {
      const body = z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          config: configSchema.optional(),
        })
        .parse(await request.json());
      await db.query(
        "UPDATE ac_projects SET name=COALESCE($3,name),config=COALESCE($4,config),updated_at=now() WHERE id=$1 AND owner_id=$2",
        [id, owner, body.name || null, body.config || null],
      );
      return { ok: true };
    }
    if (path[2] === "canvas" && method === "PUT") {
      const data = z
        .object({
          version: z.number().int().nonnegative(),
          viewport: z.object({
            x: z.number().finite(),
            y: z.number().finite(),
            zoom: z.number().min(0.05).max(5),
          }),
          nodes: z
            .array(
              z.object({
                id: z.string().uuid(),
                x: z.number().finite(),
                y: z.number().finite(),
                width: z.number().finite().positive().max(20000).optional(),
                height: z.number().finite().positive().max(20000).optional(),
              }),
            )
            .max(1000),
        })
        .parse(await request.json());
      return transaction(async (tx) => {
        const changed = await tx.query(
          "UPDATE ac_projects SET viewport=$3,version=version+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$4 RETURNING version",
          [id, owner, data.viewport, data.version],
        );
        if (!changed.rows[0])
          throw new HttpError(409, "画布已在其他页面修改，请刷新后继续");
        for (const node of data.nodes)
          await tx.query(
            "UPDATE ac_nodes SET x=$3,y=$4,width=CASE WHEN asset_id IS NOT NULL THEN COALESCE($5,width) ELSE width END,height=CASE WHEN asset_id IS NOT NULL THEN COALESCE($6,height) ELSE height END WHERE id=$1 AND project_id=$2",
            [
              node.id,
              id,
              node.x,
              node.y,
              node.width ?? null,
              node.height ?? null,
            ],
          );
        return { version: changed.rows[0].version };
      });
    }
    if (path[2] === "generations" && method === "POST") {
      await rateLimit(`${owner}:generations`, 10);
      const input = generationSchema.parse(await request.json());
      return NextResponse.json(
        publicTask(
          await transaction((tx) =>
            enqueue(
              tx,
              owner,
              id,
              input,
              request.headers.get("idempotency-key") || "",
            ),
          ),
        ),
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (path[2] === "messages" && method === "GET") {
      const before = url.searchParams.get("cursor");
      if (before && Number.isNaN(Date.parse(before)))
        throw new HttpError(422, "消息游标无效");
      const tasks = await db.query(
        "SELECT * FROM ac_tasks WHERE project_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2) ORDER BY created_at DESC LIMIT 21",
        [id, before],
      );
      const items = tasks.rows.slice(0, 20);
      return {
        items: items.map(publicTask),
        nextCursor:
          tasks.rows.length > 20 ? items.at(-1).created_at.toISOString() : null,
      };
    }
    void project;
  }
  if (path[0] === "generations" && path[1]) {
    const { rows } = await db.query(
      "SELECT * FROM ac_tasks WHERE id=$1 AND owner_id=$2",
      [uuid(path[1]), owner],
    );
    const task = rows[0];
    if (!task) throw new HttpError(404, "任务不存在");
    if (method === "GET") return publicTask(task);
    if (method === "POST" && path[2] === "retry") {
      if (task.status !== "failed")
        throw new HttpError(409, "只有已明确失败的任务可以重新生成");
      const input = generationSchema.parse({
        prompt: task.prompt,
        referenceAssetId: task.reference_asset_id,
        referenceAssetIds: task.reference_asset_ids,
        attachmentIds: task.attachment_ids,
        config: task.config,
      });
      return NextResponse.json(
        publicTask(
          await transaction((tx) =>
            enqueue(
              tx,
              owner,
              task.project_id,
              input,
              request.headers.get("idempotency-key") || "",
            ),
          ),
        ),
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  throw new HttpError(404, "接口不存在");
}
async function handler(request: Request, context: Context) {
  let raw: Response | undefined;
  const result = await respond(async () => {
    const value = await dispatch(request, context);
    if (value instanceof Response) {
      raw = value;
      return null;
    }
    return value;
  });
  return raw || result;
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
