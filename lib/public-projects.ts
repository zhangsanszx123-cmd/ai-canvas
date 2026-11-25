import "server-only";
import { getDb } from "./db";
import { HttpError } from "./http";
import { projectContentSql } from "./project-list";
import { signKey } from "./storage";
import type { ModelConfig } from "./models";

export async function publicProject(id: string) {
  const { rows } = await getDb().query(
    `SELECT p.id,p.name FROM ac_projects p WHERE p.id=$1 AND p.deleted_at IS NULL AND ${projectContentSql}`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "项目不存在");
  const images = await getDb().query(
    `SELECT n.id,n.x,n.y,n.width,n.height,a.id AS asset_id,a.width AS image_width,a.height AS image_height,a.bytes,t.config,t.image_action->>'label' AS action_label
     FROM ac_nodes n JOIN ac_assets a ON a.id=n.asset_id
     JOIN ac_projects p ON p.id=n.project_id AND p.deleted_at IS NULL
     LEFT JOIN ac_tasks t ON t.id=n.task_id AND t.owner_id=p.owner_id AND t.project_id=p.id
     WHERE n.project_id=$1 AND a.project_id=p.id AND a.owner_id=p.owner_id
       AND a.mime IN ('image/png','image/jpeg','image/webp') ORDER BY a.created_at,n.id`,
    [id],
  );
  return {
    project: rows[0] as { id: string; name: string },
    images: images.rows.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      config: (r.config || null) as ModelConfig | null,
      actionLabel: (r.action_label || null) as string | null,
      asset: {
        id: r.asset_id,
        width: r.image_width,
        height: r.image_height,
        bytes: r.bytes,
        url: `/api/public/assets/${r.asset_id}/content`,
      },
    })),
  };
}
export type PublicProject = Awaited<ReturnType<typeof publicProject>>;

export async function publicAssetUrl(
  id: string,
  download: boolean,
  preview = false,
) {
  const { rows } = await getDb().query(
    `SELECT a.object_key,a.preview_object_key FROM ac_assets a
     JOIN ac_projects p ON p.id=a.project_id AND p.owner_id=a.owner_id AND p.deleted_at IS NULL
     WHERE a.id=$1 AND a.mime IN ('image/png','image/jpeg','image/webp')
       AND EXISTS(SELECT 1 FROM ac_nodes n WHERE n.asset_id=a.id AND n.project_id=p.id)`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "图片不存在");
  return signKey(
    preview && !download
      ? rows[0].preview_object_key || rows[0].object_key
      : rows[0].object_key,
    300,
    download,
  );
}
