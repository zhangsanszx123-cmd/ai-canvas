import "server-only";
import { getDb } from "./db";
import { HttpError, uuid } from "./http";

// A row may be needed to attach uploads before a creation is submitted.
// Such rows become saved projects only once they contain content.
export const projectContentSql = `(jsonb_array_length(p.agent_messages)>0
  OR p.agent_lease_until>now()
  OR EXISTS(SELECT 1 FROM ac_nodes n WHERE n.project_id=p.id)
  OR EXISTS(SELECT 1 FROM ac_tasks t WHERE t.project_id=p.id)
  OR EXISTS(SELECT 1 FROM ac_assets a WHERE a.project_id=p.id)
  OR EXISTS(SELECT 1 FROM ac_skills s WHERE s.project_id=p.id))`;

export async function listProjects(
  owner: string | null,
  params: URLSearchParams,
) {
  const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 20));
  let cursor: { time: string; id: string } | null = null;
  if (params.get("cursor")) {
    try {
      cursor = JSON.parse(
        Buffer.from(params.get("cursor")!, "base64url").toString(),
      );
      if (!cursor?.time || !cursor.id || Number.isNaN(Date.parse(cursor.time)))
        throw new Error();
      uuid(cursor.id);
    } catch {
      throw new HttpError(422, "分页参数无效");
    }
  }
  const cover = owner
    ? "p.cover_asset_id"
    : `(SELECT n.asset_id FROM ac_nodes n
    JOIN ac_assets a ON a.id=n.asset_id AND a.project_id=p.id AND a.owner_id=p.owner_id
    WHERE n.project_id=p.id AND a.mime IN ('image/png','image/jpeg','image/webp')
    ORDER BY (n.asset_id=p.cover_asset_id) DESC NULLS LAST,a.created_at DESC,n.id DESC LIMIT 1)`;
  const { rows } = await getDb().query(
    `SELECT p.id,p.name,${cover} AS cover_asset_id,p.created_at,p.updated_at
     FROM ac_projects p WHERE ($1::uuid IS NULL OR p.owner_id=$1) AND p.deleted_at IS NULL
     AND ${projectContentSql}
     AND ($2::timestamptz IS NULL OR (p.updated_at,p.id)<($2::timestamptz,$3::uuid))
     ORDER BY p.updated_at DESC,p.id DESC LIMIT $4`,
    [owner, cursor?.time || null, cursor?.id || null, limit + 1],
  );
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    ...(owner ? { cover_asset_id: r.cover_asset_id } : {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
    coverUrl: r.cover_asset_id
      ? `/api/${owner ? "" : "public/"}assets/${r.cover_asset_id}/content`
      : null,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              time: last.updated_at.toISOString(),
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}
