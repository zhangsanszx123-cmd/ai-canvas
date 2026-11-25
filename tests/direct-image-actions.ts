import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
import { imageActionSchema } from "../lib/image-actions";
const expect = baseExpect.configure({ timeout: 30000 });
async function main() {
  const db = getDb(),
    owner = randomUUID(),
    stranger = randomUUID();
  const lock = await db.connect();
  if (
    !(
      await lock.query(
        "SELECT pg_try_advisory_lock(hashtext('ai-canvas-worker')) AS locked",
      )
    ).rows[0].locked
  ) {
    lock.release();
    await db.end();
    throw Error("Pause worker before direct-action queue tests");
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const foreign = await browser.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const guest = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await context.newPage(),
    password = randomBytes(24).toString("base64url");
  const errors: string[] = [],
    agentPosts: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/agent"))
      agentPosts.push(r.url());
  });
  try {
    for (const [id, client] of [
      [owner, context.request],
      [stranger, foreign.request],
    ] as const) {
      await db.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
        [id, "Direct action QA", `${id}@example.invalid`],
      );
      await db.query(
        'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
        [randomUUID(), id, "credential", await hashPassword(password)],
      );
      assert.equal(
        (
          await client.post("/api/auth/sign-in/email", {
            data: { email: `${id}@example.invalid`, password },
          })
        ).status(),
        200,
      );
    }
    const { id } = await (
      await context.request.post("/api/projects", { data: {} })
    ).json();
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#c3d5e9" },
    })
      .png()
      .toBuffer();
    const uploaded = await context.request.post("/api/uploads", {
      multipart: {
        projectId: id,
        file: { name: "direct-edit.png", mimeType: "image/png", buffer: png },
      },
    });
    assert.equal(uploaded.status(), 200);
    const asset = await uploaded.json();
    await db.query(
      "UPDATE ac_nodes SET width=240,height=160 WHERE project_id=$1",
      [id],
    );
    const source = (
      await db.query(
        "SELECT * FROM ac_nodes WHERE project_id=$1 AND asset_id=$2",
        [id, asset.id],
      )
    ).rows[0];
    const endpoint = `/api/projects/${id}/image-actions`;
    assert.equal(
      (
        await guest.request.post(endpoint, {
          data: {},
          headers: { Origin: "http://localhost:3000" },
        })
      ).status(),
      401,
    );
    assert.equal(
      (await foreign.request.post(endpoint, { data: {} })).status(),
      404,
    );
    const toolbar = page.getByRole("toolbar", {
      name: "图片操作",
      exact: true,
    });
    const agentDraft = page.getByRole("textbox", {
      name: "生图提示词",
      exact: true,
    });
    async function open() {
      await page.goto(`/canvas?projectId=${id}`);
      await expect(
        page.getByRole("button", { name: "选择创作模式", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "适配全部图片", exact: true })
        .click();
      await page.locator(`.react-flow__node[data-id="${source.id}"]`).click();
      await agentDraft.fill("这段 Agent 草稿不能被图片工具修改");
    }
    async function submitted(
      action: string,
      click: () => Promise<void>,
      resolution = "1k",
    ) {
      const waiting = page.waitForResponse(
        (r) => r.url().endsWith(endpoint) && r.request().method() === "POST",
      );
      await click();
      const response = await waiting;
      assert.equal(response.status(), 202, await response.text());
      const data = await response.json();
      for (const task of data.tasks) {
        assert.equal(task.imageAction.type, action);
        assert.equal(task.referenceAssetId, asset.id);
        assert.equal(task.config.resolution, resolution);
        assert.equal(task.config.size, "3:2");
        const row = (
          await db.query(
            "SELECT t.provider_id,n.x,n.y FROM ac_tasks t JOIN ac_nodes n ON n.task_id=t.id WHERE t.id=$1",
            [task.id],
          )
        ).rows[0];
        assert.equal(row.provider_id, null);
        assert(row.x > source.x);
        assert.equal(row.y, source.y);
      }
      await expect(agentDraft).toHaveValue("这段 Agent 草稿不能被图片工具修改");
      assert.equal(agentPosts.length, 0);
      assert.deepEqual(
        (
          await db.query("SELECT agent_messages FROM ac_projects WHERE id=$1", [
            id,
          ])
        ).rows[0].agent_messages,
        [],
      );
      return { data, response };
    }
    for (const [label, action] of [
      ["变清晰", "enhance"],
      ["换背景", "background"],
      ["画同款", "variant"],
    ]) {
      await open();
      let confirmVariant = false;
      if (action === "variant") {
        const count = (
          await db.query(
            "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
            [owner],
          )
        ).rows[0].count;
        await toolbar
          .getByRole("button", { name: "画同款", exact: true })
          .click();
        const variant = page.getByRole("region", {
          name: "画同款编辑",
          exact: true,
        });
        await expect(variant).toBeVisible();
        await expect(
          variant.getByRole("img", { name: "画同款参考图", exact: true }),
        ).toBeVisible();
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
              [owner],
            )
          ).rows[0].count,
          count,
        );
        await variant
          .getByRole("textbox", { name: "同款图片提示词", exact: true })
          .fill("保留原风格，把主体改为绿色");
        await expect(agentDraft).toHaveValue(
          "这段 Agent 草稿不能被图片工具修改",
        );
        confirmVariant = true;
      }
      let release: (() => void) | undefined;
      const pattern = `**${endpoint}`;
      let snapshots = 0;
      const track = (response: import("@playwright/test").Response) => {
        if (
          response.request().method() === "GET" &&
          response.url().endsWith(`/api/projects/${id}`)
        )
          snapshots++;
      };
      if (action === "enhance") {
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(pattern, async (route) => {
          await gate;
          await route.continue();
        });
        page.on("response", track);
      }
      const submission = submitted(action, () =>
        confirmVariant
          ? page
              .getByRole("region", { name: "画同款编辑", exact: true })
              .getByRole("button", { name: "生成新图片", exact: true })
              .click()
          : toolbar.getByRole("button", { name: label, exact: true }).click(),
      );
      if (action === "enhance") {
        try {
          const optimistic = page.locator(
            '.react-flow__node[data-id^="pending-image-action-"]',
          );
          await expect(optimistic).toHaveCount(1);
          await expect(optimistic).toContainText("变清晰中");
          await expect(
            optimistic.locator("img.image-action-blur"),
          ).toBeVisible();
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
                [owner],
              )
            ).rows[0].count,
            0,
          );
          await expect
            .poll(() => snapshots, { timeout: 12000 })
            .toBeGreaterThan(0);
          await expect(optimistic).toHaveCount(1);
          await mkdir("test-results/direct-image-actions", { recursive: true });
          await page.screenshot({
            path: "test-results/direct-image-actions/instant-preview.png",
          });
        } finally {
          release?.();
        }
      }
      const { data, response } = await submission;
      if (action === "variant")
        assert(data.tasks[0].prompt.includes("保留原风格，把主体改为绿色"));
      if (action === "enhance") {
        await page.unroute(pattern);
        page.off("response", track);
      }
      await expect(
        page.locator('.react-flow__node[data-id^="pending-image-action-"]'),
      ).toHaveCount(0);
      await expect(
        page.locator(`.react-flow__node[data-id="${source.id}"]`),
      ).toHaveCount(1);
      const resultNode = data.nodes[0];
      await expect(
        page.locator(
          `.react-flow__node[data-id="${resultNode.id}"] .image-action-blur`,
        ),
      ).toBeVisible();
      await expect(
        toolbar.getByRole("button", { name: label, exact: true }),
      ).toBeDisabled();
      const headers = {
        "Idempotency-Key": response.request().headers()["idempotency-key"],
      };
      const body = response.request().postDataJSON();
      if (action === "enhance") {
        const duplicate = await context.request.post(endpoint, {
          headers,
          data: body,
        });
        assert.equal(duplicate.status(), 202);
        assert.equal((await duplicate.json()).tasks[0].id, data.tasks[0].id);
        assert.equal(
          (
            await context.request.post(endpoint, {
              headers,
              data: { ...body, action: "background" },
            })
          ).status(),
          409,
        );
      }
      await db.query(
        "UPDATE ac_tasks SET status='failed',error='QA queue verification only' WHERE owner_id=$1",
        [owner],
      );
    }
    await open();
    await toolbar
      .getByRole("button", { name: "快捷编辑", exact: true })
      .click();
    const editor = page.getByRole("region", {
      name: "图片快捷编辑",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "图片编辑要求", exact: true })
      .fill("把主体改成蓝色，保留文字");
    await editor.getByRole("button", { name: "配色方案", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "使用冷色调配色", exact: true })
      .click();
    await expect(editor.getByRole("textbox")).toHaveValue(/使用冷色调配色/);
    await editor
      .getByRole("combobox", { name: "图片处理分辨率", exact: true })
      .selectOption("2k");
    await mkdir("test-results/direct-image-actions", { recursive: true });
    await page.screenshot({
      path: "test-results/direct-image-actions/editor-desktop.png",
    });
    const edited = await submitted(
      "edit",
      () =>
        editor.getByRole("button", { name: "生成新图片", exact: true }).click(),
      "2k",
    );
    await expect(editor).toHaveCount(0);
    await db.query(
      "UPDATE ac_tasks SET status='failed',error='QA queue verification only' WHERE owner_id=$1",
      [owner],
    );
    const retried = await context.request.post(
      `/api/generations/${edited.data.tasks[0].id}/retry`,
      { headers: { "Idempotency-Key": randomUUID() }, data: {} },
    );
    assert.equal(retried.status(), 202);
    assert.equal((await retried.json()).imageAction.type, "edit");
    await db.query(
      "UPDATE ac_tasks SET status='failed',error='QA queue verification only' WHERE owner_id=$1",
      [owner],
    );
    await open();
    await toolbar
      .getByRole("button", { name: "拆分元素", exact: true })
      .click();
    const splitter = page.getByRole("region", {
      name: "拆分图片元素",
      exact: true,
    });
    await splitter.getByRole("textbox").fill("品牌标志\n产品主体");
    const { data, response } = await submitted("extract", () =>
      splitter.getByRole("button", { name: "生成新图片", exact: true }).click(),
    );
    assert.equal(data.tasks.length, 2);
    const batch = await db.query(
      "SELECT DISTINCT batch_id FROM ac_tasks WHERE id=ANY($1::uuid[])",
      [data.tasks.map((task: { id: string }) => task.id)],
    );
    assert.equal(batch.rowCount, 1);
    assert(batch.rows[0].batch_id);
    const placed = (
      await db.query(
        "SELECT n.x,n.width FROM ac_nodes n JOIN ac_tasks t ON t.id=n.task_id WHERE n.project_id=$1 AND t.image_action IS NOT NULL AND t.id<>$2 ORDER BY n.x",
        [id, (await retried.json()).id],
      )
    ).rows;
    for (let i = 1; i < placed.length; i++)
      assert(
        placed[i].x >= placed[i - 1].x + placed[i - 1].width,
        "Direct results must not overlap",
      );
    assert.equal(
      (
        await context.request.post(endpoint, {
          headers: {
            "Idempotency-Key": response.request().headers()["idempotency-key"],
          },
          data: {
            ...response.request().postDataJSON(),
            elements: ["品牌标志"],
          },
        })
      ).status(),
      409,
    );
    await db.query(
      "UPDATE ac_tasks SET status='failed',error='QA queue verification only' WHERE owner_id=$1",
      [owner],
    );
    assert.equal(
      imageActionSchema.safeParse({ sourceNodeId: source.id, action: "edit" })
        .success,
      false,
    );
    assert.equal(
      imageActionSchema.safeParse({
        sourceNodeId: source.id,
        action: "extract",
        elements: ["A", "A"],
      }).success,
      false,
    );
    await db.query("DELETE FROM ac_rate_limits WHERE key=$1", [
      `${owner}:generations`,
    ]);
    await db.query(
      "UPDATE ac_projects SET agent_lease_until=now()+interval '1 minute' WHERE id=$1",
      [id],
    );
    assert.equal(
      (
        await context.request.post(endpoint, {
          headers: { "Idempotency-Key": randomUUID() },
          data: { sourceNodeId: source.id, action: "enhance" },
        })
      ).status(),
      409,
    );
    await db.query(
      "UPDATE ac_projects SET agent_lease_until=NULL WHERE id=$1",
      [id],
    );
    await open();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await page
      .getByRole("button", { name: "适配全部图片", exact: true })
      .click();
    await page.locator(`.react-flow__node[data-id="${source.id}"]`).click();
    await toolbar
      .getByRole("button", { name: "快捷编辑", exact: true })
      .click();
    await expect(editor).toBeVisible();
    await expect
      .poll(async () => {
        const box = await editor.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= 391;
      })
      .toBe(true);
    await page.screenshot({
      path: "test-results/direct-image-actions/editor-mobile.png",
    });
    assert.equal(agentPosts.length, 0);
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "PASS real direct-action API/queue and UI, no Agent POST/draft mutation, default 1K/source ratio, adjacent placeholders, duplicate/batch idempotency, account/guest/Agent-lease protection, inline editor/options/mobile. Worker paused; no supplier requests or generated images.",
    );
  } finally {
    await browser.close();
    const assets = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=ANY($1::uuid[])",
      [[owner, stranger]],
    );
    for (const asset of assets.rows) await deleteObject(asset.object_key);
    await db.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
      [owner, stranger],
    ]);
    await lock.query("SELECT pg_advisory_unlock(hashtext('ai-canvas-worker'))");
    lock.release();
    await db.end();
  }
}
void main().catch((error) => {
  console.error(
    error.name,
    error.message.replace(/https?:\/\/\S+/g, "[url]"),
    error.stack
      ?.split("\n")
      .find((line: string) => line.includes("direct-image-actions.ts")),
  );
  process.exitCode = 1;
});
