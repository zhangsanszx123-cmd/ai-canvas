import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
const expect = baseExpect.configure({ timeout: 30000 });
async function main() {
  const db = getDb(),
    owner = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [owner, "Toolbar QA", `${owner}@example.invalid`],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), owner, "credential", await hashPassword(password)],
    );
    assert.equal(
      (
        await context.request.post("/api/auth/sign-in/email", {
          data: { email: `${owner}@example.invalid`, password },
        })
      ).status(),
      200,
    );
    const { id } = await (
      await context.request.post("/api/projects", { data: {} })
    ).json();
    const png = await sharp({
      create: { width: 600, height: 360, channels: 3, background: "#c5d2e7" },
    })
      .png()
      .toBuffer();
    const upload = await context.request.post("/api/uploads", {
      multipart: {
        projectId: id,
        file: {
          name: "toolbar-reference.png",
          mimeType: "image/png",
          buffer: png,
        },
      },
    });
    assert.equal(upload.status(), 200);
    const asset = await upload.json();
    await page.goto(`/canvas?projectId=${id}`);
    await expect(
      page.getByRole("button", { name: "选择创作模式", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "适配全部图片", exact: true })
      .click();
    const node = page.locator(".react-flow__node-image").first();
    await node.click();
    const toolbar = page.getByRole("toolbar", {
      name: "图片操作",
      exact: true,
    });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toContainText("600 × 360");
    const textarea = page.getByRole("textbox", {
      name: "生图提示词",
      exact: true,
    });
    await textarea.fill("保留这段未发送的要求");
    await toolbar
      .getByRole("button", { name: "快捷编辑", exact: true })
      .click();
    const editor = page.getByRole("region", {
      name: "图片快捷编辑",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await expect(textarea).toHaveValue("保留这段未发送的要求");
    await editor
      .getByRole("textbox", { name: "图片编辑要求", exact: true })
      .fill("把主体改成蓝色");
    await editor.getByRole("button", { name: "配色方案", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "使用冷色调配色", exact: true })
      .click();
    await expect(editor.getByRole("textbox")).toHaveValue(/使用冷色调配色/);
    await page
      .getByRole("button", { name: "关闭图片编辑", exact: true })
      .click();
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
      0,
    );
    // Completed source-task metadata is a UI fixture, not a supplier result.
    const sourcePrompt = "测试原始提示词：简洁的品牌字标，厚实圆角，黑白配色";
    const sourceTask = randomUUID();
    await db.query(
      "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,config,idempotency_key,request_hash,status) VALUES($1,$2,$3,$4,$5,$6,'ui-source-fixture','completed')",
      [
        sourceTask,
        id,
        owner,
        sourcePrompt,
        { model: "gpt-image-2", size: "3:2", resolution: "1k", n: 1 },
        randomUUID(),
      ],
    );
    await db.query(
      "UPDATE ac_nodes SET task_id=$1 WHERE project_id=$2 AND asset_id=$3",
      [sourceTask, id, asset.id],
    );
    await page.reload();
    await expect(node).toBeVisible();
    await node.click();
    await toolbar.getByRole("button", { name: "画同款", exact: true }).click();
    const variant = page.getByRole("region", {
      name: "画同款编辑",
      exact: true,
    });
    await expect(variant).toBeVisible();
    await expect(
      variant.getByRole("textbox", { name: "同款图片提示词", exact: true }),
    ).toHaveValue(sourcePrompt);
    await expect(
      variant.getByRole("img", { name: "画同款参考图", exact: true }),
    ).toBeVisible();
    await variant.getByRole("textbox").fill("");
    await expect(
      variant.getByRole("button", { name: "生成新图片", exact: true }),
    ).toBeDisabled();
    await variant.getByRole("textbox").fill("保留字形，改为蓝绿色");
    await expect(
      variant.getByRole("button", { name: "生成新图片", exact: true }),
    ).toBeEnabled();
    await expect(
      variant.getByRole("combobox", { name: "图片处理分辨率", exact: true }),
    ).toHaveValue("1k");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await expect(variant).toBeVisible();
    await expect
      .poll(async () => {
        const box = await variant.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= 391;
      })
      .toBe(true);
    await expect(
      variant.getByRole("combobox", { name: "图片处理分辨率", exact: true }),
    ).toBeVisible();
    await mkdir("test-results/image-toolbar", { recursive: true });
    await page.screenshot({
      path: "test-results/image-toolbar/variant-mobile.png",
    });
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
      1,
    );
    await page
      .getByRole("button", { name: "关闭图片编辑", exact: true })
      .click();
    await expect(variant).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await toolbar
      .getByRole("button", { name: "放大画布图片", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "图片预览", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const download = toolbar.getByRole("link", {
      name: "下载图片",
      exact: true,
    });
    assert.equal(
      (
        await context.request.get(
          (await download.getAttribute("href")) as string,
          { maxRedirects: 0 },
        )
      ).status(),
      307,
    );
    await page.getByRole("button", { name: "缩小", exact: true }).click();
    await expect(toolbar).toBeVisible();
    async function withinCanvas() {
      const box = await toolbar.boundingBox(),
        canvas = await page.locator(".react-flow").boundingBox();
      return (
        !!box &&
        !!canvas &&
        box.x >= canvas.x &&
        box.x + box.width <= canvas.x + canvas.width + 1 &&
        box.y >= canvas.y &&
        box.y + box.height <= canvas.y + canvas.height
      );
    }
    await expect.poll(withinCanvas).toBe(true);
    await mkdir("test-results/image-toolbar", { recursive: true });
    await page.screenshot({ path: "test-results/image-toolbar/desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await page
      .getByRole("button", { name: "适配全部图片", exact: true })
      .click();
    await node.click();
    await expect(toolbar).toBeVisible();
    await expect.poll(withinCanvas).toBe(true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: "test-results/image-toolbar/mobile.png" });
    await toolbar
      .getByRole("button", { name: "快捷编辑", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "图片快捷编辑", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "关闭图片编辑", exact: true })
      .click();
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await toolbar
      .getByRole("button", { name: "更多图片操作", exact: true })
      .click();
    const removal = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(`/api/projects/${id}/nodes/`),
    );
    await page
      .getByRole("menuitem", { name: "从画布移除", exact: true })
      .click();
    const removed = await removal;
    assert.equal(removed.status(), 200, await removed.text());
    await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
    assert.equal(
      (await db.query("SELECT id FROM ac_assets WHERE id=$1", [asset.id]))
        .rowCount,
      1,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "PASS selected-image floating toolbar, inline editor/options preserve Agent draft with no generation, preview/download, zoom/mobile bounds, mobile edit handoff and canvas-only removal.",
    );
  } catch (error) {
    await mkdir("test-results/image-toolbar", { recursive: true });
    await page
      .screenshot({ path: "test-results/image-toolbar/failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
    const assets = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=$1",
      [owner],
    );
    for (const asset of assets.rows) await deleteObject(asset.object_key);
    await db.query('DELETE FROM "user" WHERE id=$1', [owner]);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(
    error.name,
    error.message.replace(/https?:\/\/\S+/g, "[url]"),
    error.stack
      ?.split("\n")
      .find((line: string) => line.includes("image-toolbar-ui.ts")),
  );
  process.exitCode = 1;
});
