import { getDb } from "../lib/db";
import { backfillImagePreview } from "../lib/storage";

async function main() {
  const db = getDb();
  try {
    const project = process.argv[2];
    const { rows } = await db.query(
      `SELECT a.id FROM ac_assets a JOIN ac_projects p ON p.id=a.project_id
       WHERE p.deleted_at IS NULL AND a.preview_object_key IS NULL
       AND a.mime IN ('image/png','image/jpeg','image/webp')
       AND ($1::uuid IS NULL OR a.project_id=$1::uuid)`,
      [project || null],
    );
    let completed = 0,
      originalBytes = 0,
      previewBytes = 0;
    for (let offset = 0; offset < rows.length; offset += 3) {
      const results = await Promise.all(
        rows
          .slice(offset, offset + 3)
          .map((row) => backfillImagePreview(row.id)),
      );
      for (const result of results)
        if (result) {
          completed++;
          originalBytes += result.originalBytes;
          previewBytes += result.previewBytes;
        }
      console.log(
        JSON.stringify({
          completed,
          total: rows.length,
          originalBytes,
          previewBytes,
        }),
      );
    }
  } finally {
    await db.end();
  }
}
void main().catch(() => {
  console.error("预览补齐失败；可安全重试，原图未修改。");
  process.exitCode = 1;
});
