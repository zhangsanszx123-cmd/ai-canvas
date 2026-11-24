import "server-only";
import { getDb } from "./db";
import { assetUrl, putAsset, deleteObject } from "./storage";
import { submit, queryProvider, downloadResult } from "./provider";
import { transaction } from "./repository";
import type { ModelConfig } from "./models";
import { providerFailureMessage } from "./provider-errors";

type Task = {
  id: string;
  owner_id: string;
  project_id: string;
  prompt: string;
  reference_asset_id: string | null;
  reference_asset_ids: string[];
  config: ModelConfig;
  provider_id: string | null;
  status: string;
  results: { url: string; assetId?: string }[];
  attempts: number;
  submitted_at: Date | null;
};
export async function tick(onlyOwner?: string) {
  await getDb().query(
    "INSERT INTO ac_worker_health(id,heartbeat) VALUES($1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat=now()",
    [onlyOwner ? `test:${onlyOwner}` : "main"],
  );
  // An interrupted POST may have reached the provider. Never blindly resubmit it.
  await getDb().query(
    "UPDATE ac_tasks SET status='submission_unknown',error='工作进程在提交时中断，需核对供应商任务后恢复',lease_until=NULL WHERE status='submitting' AND submitted_at IS NOT NULL AND provider_id IS NULL AND (lease_until IS NULL OR lease_until<now()) AND ($1::uuid IS NULL OR owner_id=$1)",
    [onlyOwner || null],
  );
  const task = await transaction(async (db) => {
    const { rows } = await db.query<Task>(
      "SELECT * FROM ac_tasks WHERE status=ANY($1::text[]) AND next_poll<=now() AND (lease_until IS NULL OR lease_until<now()) AND ($2::uuid IS NULL OR owner_id=$2) ORDER BY next_poll LIMIT 1 FOR UPDATE SKIP LOCKED",
      [["submitting", "queued", "in_progress", "saving"], onlyOwner || null],
    );
    if (!rows[0]) return null;
    await db.query(
      "UPDATE ac_tasks SET lease_until=now()+interval '5 minutes',submitted_at=CASE WHEN status='submitting' THEN COALESCE(submitted_at,now()) ELSE submitted_at END WHERE id=$1",
      [rows[0].id],
    );
    return rows[0];
  });
  if (!task) return false;
  let attemptedSubmission = false;
  try {
    if (!task.provider_id) {
      const referenceIds = task.reference_asset_ids?.length
        ? task.reference_asset_ids
        : task.reference_asset_id
          ? [task.reference_asset_id]
          : [];
      const ref = await Promise.all(
        referenceIds.map((id) => assetUrl(id, task.owner_id, 86400)),
      );
      let providerId: string;
      try {
        attemptedSubmission = true;
        providerId = await submit(
          {
            prompt: task.prompt,
            referenceAssetId: task.reference_asset_id,
            referenceAssetIds: referenceIds,
            config: task.config,
          },
          ref,
        );
      } catch (e) {
        const uncertain =
          e instanceof TypeError ||
          (e instanceof Error &&
            (e.name === "TimeoutError" ||
              e.name === "AbortError" ||
              ("uncertain" in e && e.uncertain)));
        await getDb().query(
          "UPDATE ac_tasks SET status=$2,error=$3,lease_until=NULL,updated_at=now() WHERE id=$1",
          [
            task.id,
            uncertain ? "submission_unknown" : "failed",
            uncertain
              ? "提交连接中断，受理状态待核对，请勿重复发送"
              : e instanceof Error
                ? e.message
                : "提交失败",
          ],
        );
        return true;
      }
      task.provider_id = providerId;
      await getDb().query(
        "UPDATE ac_tasks SET provider_id=$2,status='queued',lease_until=NULL,next_poll=now()+interval '5 seconds',updated_at=now() WHERE id=$1",
        [task.id, providerId],
      );
      return true;
    }
    if (task.status !== "saving") {
      const data = await queryProvider(task.provider_id);
      if (data.status === "failed") {
        await getDb().query(
          "UPDATE ac_tasks SET status='failed',error=$2,lease_until=NULL,updated_at=now() WHERE id=$1",
          [task.id, providerFailureMessage(data.error)],
        );
        return true;
      }
      if (data.status !== "completed") {
        await getDb().query(
          "UPDATE ac_tasks SET status='in_progress',progress=$2,lease_until=NULL,next_poll=now()+interval '8 seconds',updated_at=now() WHERE id=$1",
          [task.id, Math.max(0, Math.min(99, Number(data.progress) || 0))],
        );
        return true;
      }
      const results = data.result?.data
        ?.filter((r) => typeof r.url === "string")
        .map((r) => ({ url: r.url }));
      if (!results?.length) throw new Error("供应商尚未返回有效结果地址");
      task.results = results;
      await getDb().query(
        "UPDATE ac_tasks SET status='saving',results=$2,progress=99,updated_at=now() WHERE id=$1",
        [task.id, JSON.stringify(results)],
      );
    }
    for (let index = 0; index < task.results.length; index++) {
      if (task.results[index].assetId) continue;
      const asset = await putAsset(
        task.owner_id,
        task.project_id,
        await downloadResult(task.results[index].url),
        "generated",
      );
      try {
        await transaction(async (db) => {
          const node = await db.query(
            "SELECT y FROM ac_nodes WHERE task_id=$1 ORDER BY result_index LIMIT 1",
            [task.id],
          );
          await db.query(
            "INSERT INTO ac_nodes(id,project_id,task_id,asset_id,result_index,x,y,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,480,$8) ON CONFLICT(task_id,result_index) DO UPDATE SET asset_id=EXCLUDED.asset_id,width=EXCLUDED.width,height=EXCLUDED.height",
            [
              crypto.randomUUID(),
              task.project_id,
              task.id,
              asset.id,
              index,
              80 + index * 512,
              node.rows[0]?.y || 80,
              (480 * asset.height) / asset.width,
            ],
          );
          task.results[index].assetId = asset.id;
          await db.query("UPDATE ac_tasks SET results=$2 WHERE id=$1", [
            task.id,
            JSON.stringify(task.results),
          ]);
          if (index === 0)
            await db.query(
              "UPDATE ac_projects SET cover_asset_id=$2,updated_at=now() WHERE id=$1",
              [task.project_id, asset.id],
            );
        });
      } catch (e) {
        const orphan = await getDb().query(
          "DELETE FROM ac_assets WHERE id=$1 RETURNING object_key",
          [asset.id],
        );
        if (orphan.rows[0])
          await deleteObject(orphan.rows[0].object_key).catch(() => {});
        throw e;
      }
    }
    await getDb().query(
      "UPDATE ac_tasks SET status='completed',progress=100,error=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
      [task.id],
    );
  } catch (e) {
    if (task.status === "submitting") {
      await getDb().query(
        "UPDATE ac_tasks SET provider_id=COALESCE(provider_id,$2),status=$3,error=$4,lease_until=NULL,next_poll=now()+interval '10 seconds' WHERE id=$1",
        [
          task.id,
          task.provider_id,
          task.provider_id
            ? "queued"
            : attemptedSubmission
              ? "submission_unknown"
              : "failed",
          task.provider_id
            ? "任务已受理，等待查询"
            : attemptedSubmission
              ? "任务受理状态待核对，请勿重复发送"
              : "参考图暂时无法读取，请重新选择后重试",
        ],
      );
      return true;
    }
    const delay = Math.min(300, 10 * 2 ** Math.min(task.attempts, 5));
    const error =
      task.status === "saving" || task.results.length
        ? "图片生成完成，保存失败，正在重试保存"
        : "暂时无法查询任务，正在重试";
    await getDb().query(
      "UPDATE ac_tasks SET error=$2,attempts=attempts+1,lease_until=NULL,next_poll=now()+$3*interval '1 second',updated_at=now() WHERE id=$1",
      [task.id, error, delay],
    );
    console.error(
      "worker_task_retry",
      task.id,
      e instanceof Error ? e.name : "Error",
      e instanceof Error
        ? e.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 180)
        : "",
    );
  }
  return true;
}
export async function cleanup() {
  await transaction(async (db) => {
    const rows = await db.query(
      "SELECT id,object_key FROM ac_assets WHERE project_id IS NULL AND created_at<now()-interval '24 hours' LIMIT 50 FOR UPDATE SKIP LOCKED",
    );
    for (const asset of rows.rows) {
      await deleteObject(asset.object_key);
      await db.query(
        "DELETE FROM ac_assets WHERE id=$1 AND project_id IS NULL",
        [asset.id],
      );
    }
  });
  await getDb().query(
    "DELETE FROM ac_rate_limits WHERE expires_at<now()-interval '1 day'",
  );
}
