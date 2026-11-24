import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { request } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
import {
  AGENT_IMAGE_MODEL,
  defaultConfig,
  providerPayload,
} from "../lib/models";

async function main() {
  const db = getDb();
  const queueLock = process.argv.includes("--queue")
    ? await db.connect()
    : null;
  if (
    queueLock &&
    !(
      await queueLock.query(
        "SELECT pg_try_advisory_lock(hashtext('ai-canvas-worker')) AS locked",
      )
    ).rows[0].locked
  ) {
    queueLock.release();
    await db.end();
    throw new Error("Stop worker before queue contract tests");
  }
  const owner = randomUUID();
  const stranger = randomUUID();
  const email = `agent-qa-${owner}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const client = await request.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
    timeout: 30000,
  });
  const foreign = await request.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
    timeout: 30000,
  });
  try {
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [owner, "Agent QA", email],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), owner, "credential", await hashPassword(password)],
    );
    assert.equal(
      (
        await client.post("/api/auth/sign-in/email", {
          data: { email, password },
        })
      ).status(),
      200,
    );
    const created = await client.post("/api/projects", { data: {} });
    assert.equal(created.status(), 200);
    const { id } = await created.json();
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [stranger, "Agent QA Stranger", `stranger-${stranger}@example.invalid`],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), stranger, "credential", await hashPassword(password)],
    );
    assert.equal(
      (
        await foreign.post("/api/auth/sign-in/email", {
          data: { email: `stranger-${stranger}@example.invalid`, password },
        })
      ).status(),
      200,
    );
    assert.equal((await foreign.get(`/api/projects/${id}`)).status(), 404);
    assert.equal(
      (
        await foreign.post(`/api/projects/${id}/agent`, {
          data: { prompt: "读取画布" },
        })
      ).status(),
      404,
    );
    const second = await (
      await client.post("/api/projects", { data: {} })
    ).json();
    const md = await client.post("/api/uploads", {
      multipart: {
        projectId: id,
        file: {
          name: "brief.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(
            "# 测试创作简报\n红色圆形，不执行 <script>alert(1)</script>",
          ),
        },
      },
    });
    assert.equal(md.status(), 200);
    const markdown = await md.json();
    assert.equal(
      (await foreign.get(`/api/assets/${markdown.id}/url`)).status(),
      404,
    );
    assert.equal(
      (
        await foreign.get(`/api/projects/${id}/attachments/${markdown.id}/text`)
      ).status(),
      404,
    );
    const read = await client.get(
      `/api/projects/${id}/attachments/${markdown.id}/text`,
    );
    assert.equal(read.status(), 200);
    assert.match((await read.json()).text, /测试创作简报/);
    assert.equal(
      (
        await client.get(
          `/api/projects/${second.id}/attachments/${markdown.id}/text`,
        )
      ).status(),
      404,
    );
    const image = await client.post("/api/uploads", {
      multipart: {
        projectId: id,
        file: {
          name: "portrait.png",
          mimeType: "image/png",
          buffer: await sharp({
            create: { width: 100, height: 300, channels: 3, background: "red" },
          })
            .png()
            .toBuffer(),
        },
      },
    });
    assert.equal(image.status(), 200);
    const asset = await image.json();
    assert.equal(
      (await foreign.get(`/api/assets/${asset.id}/url`)).status(),
      404,
    );
    const snapshot = await (await client.get(`/api/projects/${id}`)).json();
    assert.equal(snapshot.nodes.length, 1);
    assert.equal(
      (
        await foreign.delete(
          `/api/projects/${id}/nodes/${snapshot.nodes[0].id}`,
        )
      ).status(),
      404,
    );
    assert.equal(
      (
        await foreign.post(`/api/projects/${id}/nodes`, {
          data: { assetId: asset.id },
        })
      ).status(),
      404,
    );
    assert.equal(snapshot.nodes[0].height / snapshot.nodes[0].width, 3);
    const copied = await client.post(`/api/projects/${id}/nodes`, {
      data: { assetId: asset.id, x: 200, y: 200 },
    });
    assert.equal(copied.status(), 200);
    assert.equal(
      (
        await client.post(`/api/projects/${second.id}/nodes`, {
          data: { assetId: asset.id },
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await client.delete(`/api/projects/${id}/nodes/${snapshot.nodes[0].id}`)
      ).status(),
      200,
    );
    assert.equal(
      (await (await client.get(`/api/projects/${id}`)).json()).nodes.length,
      1,
    );
    assert.equal(
      (await client.get(`/api/assets/${asset.id}/url`)).status(),
      200,
    );
    console.log(
      "PASS real private Markdown upload/read; project isolation; portrait bounds; image copy/delete persistence; original retained",
    );
    const agent = await client.post(`/api/projects/${id}/agent`, {
      data: {
        prompt: "请只读取画布，简短告诉我有几张图片，不要生成图片。",
        attachmentIds: [markdown.id],
      },
    });
    assert.equal(agent.status(), 200);
    const events = (await agent.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
      "Agent real request returned error",
    );
    assert(events.some((e) => e.type === "tool_execution_end"));
    assert(events.some((e) => e.type === "text_delta"));
    console.log("PASS real DeepSeek Pi tool call and streamed response");
    const history = await (
      await client.get(`/api/projects/${id}/agent`)
    ).json();
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].attachmentIds[0], markdown.id);
    assert(
      history.messages[0].events.some(
        (e: { type: string }) => e.type === "text_delta",
      ),
    );
    assert.equal(
      (await foreign.get(`/api/projects/${id}/agent`)).status(),
      404,
    );
    const followUp = await client.post(`/api/projects/${id}/agent`, {
      data: { prompt: "只回答刚才附件中的创作颜色，不要调用生图。" },
    });
    const followUpText = await followUp.text();
    assert(!followUpText.includes('"type":"error"'));
    assert(
      (await (await client.get(`/api/projects/${id}/agent`)).json()).messages
        .length === 2,
    );
    console.log(
      "PASS cross-user project/asset/node/attachment/Agent isolation; persisted history and real multi-turn context",
    );
    if (queueLock) {
      const secondImage = await client.post("/api/uploads", {
        multipart: {
          projectId: id,
          file: {
            name: "second.png",
            mimeType: "image/png",
            buffer: await sharp({
              create: {
                width: 300,
                height: 100,
                channels: 3,
                background: "blue",
              },
            })
              .png()
              .toBuffer(),
          },
        },
      });
      const another = await secondImage.json();
      const refs = [another.id, asset.id];
      const config = { ...defaultConfig, model: AGENT_IMAGE_MODEL };
      const failedId = randomUUID();
      await db.query(
        "INSERT INTO ac_tasks(id,owner_id,project_id,prompt,config,reference_asset_id,reference_asset_ids,attachment_ids,idempotency_key,request_hash,status) VALUES($1,$2,$3,'Queue contract QA',$4,$5,$6,$7,$8,'fixture','failed')",
        [
          failedId,
          owner,
          id,
          config,
          refs[0],
          JSON.stringify(refs),
          JSON.stringify([markdown.id, ...refs]),
          randomUUID(),
        ],
      );
      const retryKey = randomUUID();
      const retry = await client.post(`/api/generations/${failedId}/retry`, {
        data: {},
        headers: { "Idempotency-Key": retryKey },
      });
      assert.equal(retry.status(), 202);
      const retryTask = await retry.json();
      assert.equal(retryTask.config.model, AGENT_IMAGE_MODEL);
      assert.deepEqual(retryTask.referenceAssetIds, refs);
      assert.deepEqual(retryTask.attachmentIds, [markdown.id, ...refs]);
      assert.equal(
        (
          await (
            await client.post(`/api/generations/${failedId}/retry`, {
              data: {},
              headers: { "Idempotency-Key": retryKey },
            })
          ).json()
        ).id,
        retryTask.id,
      );
      assert.equal(
        (await foreign.get(`/api/generations/${retryTask.id}`)).status(),
        404,
      );
      assert.equal(
        (
          await foreign.post(`/api/generations/${retryTask.id}/retry`, {
            data: {},
            headers: { "Idempotency-Key": randomUUID() },
          })
        ).status(),
        404,
      );
      await db.query("UPDATE ac_tasks SET status='failed' WHERE id=$1", [
        retryTask.id,
      ]);
      const regenerated = await client.post(`/api/projects/${id}/generations`, {
        data: {
          prompt: retryTask.prompt,
          config: retryTask.config,
          referenceAssetId: retryTask.referenceAssetId,
          referenceAssetIds: retryTask.referenceAssetIds,
          attachmentIds: retryTask.attachmentIds,
        },
        headers: { "Idempotency-Key": randomUUID() },
      });
      assert.equal(regenerated.status(), 202);
      const regeneratedTask = await regenerated.json();
      assert.equal(regeneratedTask.config.model, AGENT_IMAGE_MODEL);
      assert.deepEqual(regeneratedTask.referenceAssetIds, refs);
      await db.query("UPDATE ac_tasks SET status='failed' WHERE id=$1", [
        regeneratedTask.id,
      ]);
      const ordinary = await client.post(`/api/projects/${id}/generations`, {
        data: {
          prompt: "Ordinary generation QA",
          config: defaultConfig,
          referenceAssetId: asset.id,
          attachmentIds: [markdown.id, asset.id],
        },
        headers: { "Idempotency-Key": randomUUID() },
      });
      assert.equal(ordinary.status(), 202);
      const ordinaryTask = await ordinary.json();
      assert.equal(ordinaryTask.config.model, defaultConfig.model);
      assert.deepEqual(ordinaryTask.attachmentIds, [markdown.id, asset.id]);
      const orderedPayload = providerPayload(
        { prompt: "order", config: config as typeof defaultConfig },
        ["https://example.invalid/two", "https://example.invalid/one"],
      );
      assert.deepEqual(
        "reference_images" in orderedPayload
          ? orderedPayload.reference_images
          : undefined,
        ["https://example.invalid/two", "https://example.invalid/one"],
      );
      console.log(
        "PASS real retry/regenerate API preserves GPT Image 2.5, ordered references and attachments; idempotency; task isolation; ordinary model unchanged (queue locked, no generation submitted)",
      );
    }
    if (process.argv.includes("--generate")) {
      for (const referenceIds of [[], [asset.id]]) {
        const generation = await client.post(`/api/projects/${id}/agent`, {
          timeout: 120000,
          data: {
            prompt: referenceIds.length
              ? "先调用 view_image 真正查看图一，然后基于图一生成一张红色长方形中间有白色圆形的极简图片，使用1k分辨率，只生成一张。"
              : "请生成一张白底红色圆形的极简图片，使用1k分辨率，只生成一张。",
            attachmentIds: referenceIds,
          },
        });
        assert.equal(generation.status(), 200);
        const streamed = (await generation.text())
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const tool = streamed.find(
          (e) => e.type === "tool_execution_end" && e.result?.taskId,
        );
        assert(tool, "Agent must actually create generation task");
        const taskId = tool.result.taskId;
        if (referenceIds.length)
          assert(
            streamed.some(
              (e) =>
                e.type === "tool_execution_end" &&
                e.result?.assetId === asset.id,
            ),
          );
        const deadline = Date.now() + 480000;
        let completed = false;
        while (Date.now() < deadline) {
          const task = await (
            await client.get(`/api/generations/${taskId}`)
          ).json();
          assert.equal(task.config.model, "gpt-image-2.5-sunburst");
          assert.deepEqual(task.referenceAssetIds, referenceIds);
          if (task.status === "failed" || task.status === "submission_unknown")
            throw new Error(`Real generation ${task.status}: ${task.error}`);
          if (task.status === "completed") {
            assert(task.results.length > 0);
            assert.equal(
              (
                await client.get(`/api/assets/${task.results[0].assetId}/url`)
              ).status(),
              200,
            );
            completed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        assert(
          completed,
          "Generation did not complete within observation period",
        );
        console.log(
          `PASS real GPT Image 2.5 ${referenceIds.length ? "image-to-image with verified pixel viewing" : "text-to-image"}, ordered references, result persistence`,
        );
      }
    }
  } finally {
    const objects = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=$1",
      [owner],
    );
    for (const row of objects.rows) await deleteObject(row.object_key);
    await db.query('DELETE FROM "user" WHERE id=$1', [owner]);
    await db.query('DELETE FROM "user" WHERE id=$1', [stranger]);
    await foreign.dispose();
    await client.dispose();
    if (queueLock) {
      await queueLock.query(
        "SELECT pg_advisory_unlock(hashtext('ai-canvas-worker'))",
      );
      queueLock.release();
    }
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error.name, error.message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exitCode = 1;
});
