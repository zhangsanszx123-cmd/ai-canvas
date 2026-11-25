import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { imageActionSchema, imageActionLabels } from "./image-actions";
import { transaction, enqueue } from "./repository";
import {
  AGENT_IMAGE_MODEL,
  generationSchema,
  agentImageSizeSchema,
  ratios,
} from "./models";
import { HttpError } from "./http";

export async function enqueueImageAction(
  owner: string,
  project: string,
  raw: unknown,
  key: string,
) {
  const input = imageActionSchema.parse(raw);
  if (!/^[\w-]{8,110}$/.test(key))
    throw new HttpError(422, "缺少有效的请求标识");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [owner]);
    const source = await db.query(
      `SELECT n.x,n.y,n.width,n.height,a.id AS asset_id,a.width AS image_width,a.height AS image_height,p.agent_lease_until>now() AS agent_busy
       FROM ac_nodes n JOIN ac_projects p ON p.id=n.project_id
       JOIN ac_assets a ON a.id=n.asset_id AND a.project_id=p.id AND a.owner_id=p.owner_id
       WHERE n.id=$1 AND n.project_id=$2 AND p.owner_id=$3 AND p.deleted_at IS NULL FOR UPDATE OF p,n`,
      [input.sourceNodeId, project, owner],
    );
    const node = source.rows[0];
    if (!node) throw new HttpError(404, "画布图片不存在或已移除");
    const prior = (
      await db.query(
        "SELECT batch_id,image_action FROM ac_tasks WHERE owner_id=$1 AND idempotency_key=$2",
        [owner, `${key}_0`],
      )
    ).rows[0];
    if (prior && prior.image_action?.requestHash !== hash)
      throw new HttpError(409, "请求标识已用于其他图片操作");
    if (!prior && node.agent_busy)
      throw new HttpError(409, "Agent 正在处理当前项目，请稍后再操作");
    const exact = agentImageSizeSchema.safeParse(
      `${node.image_width}x${node.image_height}`,
    );
    const size = exact.success
      ? exact.data
      : [...ratios].sort((a, b) => {
          const distance = (ratio: string) => {
            const [w, h] = ratio.split(":").map(Number);
            return Math.abs(
              Math.log(node.image_width / node.image_height / (w / h)),
            );
          };
          return distance(a) - distance(b);
        })[0];
    const prompts =
      input.action === "extract"
        ? input.elements.map(
            (element) =>
              `根据参考图片，单独提取并重绘这个元素：${element}。保留元素的外观、配色、文字和风格，干净纯白背景，不保留其他元素。只生成该元素的独立素材图片。`,
          )
        : [
            {
              edit: `按以下要求编辑参考图片：${input.instruction}。除明确要求修改的部分外，保留原主体、文字和构图。`,
              enhance:
                "优化参考图片的视觉清晰度与细节，保留原主体、构图、文字、配色及比例，不增加额外元素。",
              background:
                "保留参考图片主体、外观、文字和细节，将原背景替换为干净纯白背景，保持主体边缘自然，不增加其他元素。",
              variant: `参考图片的视觉风格、主体特点和配色，按以下要求创作同风格的新图片，保留需要准确呈现的文字。用户要求：${input.instruction}`,
            }[input.action],
          ];
    const batchId =
      prompts.length > 1 ? prior?.batch_id || randomUUID() : undefined;
    const occupied = (
      await db.query(
        "SELECT x,y,width,height FROM ac_nodes WHERE project_id=$1",
        [project],
      )
    ).rows;
    const resultWidth = 480;
    const resultHeight = (resultWidth * node.image_height) / node.image_width;
    let nextX = node.x + node.width + 40;
    const tasks = [];
    for (const [index, prompt] of prompts.entries()) {
      const task = await enqueue(
        db,
        owner,
        project,
        generationSchema.parse({
          prompt,
          referenceAssetId: node.asset_id,
          referenceAssetIds: [node.asset_id],
          config: {
            model: AGENT_IMAGE_MODEL,
            size,
            resolution: input.resolution,
            n: 1,
          },
        }),
        `${key}_${index}`,
        batchId,
      );
      if (!task.image_action) {
        let collision;
        while (
          (collision = occupied.find(
            (rect) =>
              nextX < rect.x + rect.width + 24 &&
              nextX + resultWidth + 24 > rect.x &&
              node.y < rect.y + rect.height + 24 &&
              node.y + resultHeight + 24 > rect.y,
          ))
        )
          nextX = collision.x + collision.width + 24;
        const action = {
          type: input.action,
          label: imageActionLabels[input.action],
          sourceNodeId: input.sourceNodeId,
          sourceAssetId: node.asset_id,
          requestHash: hash,
          requestKey: key,
          elementIndex: index,
        };
        await db.query("UPDATE ac_tasks SET image_action=$2 WHERE id=$1", [
          task.id,
          action,
        ]);
        await db.query(
          "UPDATE ac_nodes SET x=$2,y=$3,width=$4,height=$5 WHERE task_id=$1",
          [task.id, nextX, node.y, resultWidth, resultHeight],
        );
        occupied.push({
          x: nextX,
          y: node.y,
          width: resultWidth,
          height: resultHeight,
        });
        nextX += resultWidth + 24;
        task.image_action = action;
      }
      tasks.push(task);
    }
    return tasks;
  });
}
