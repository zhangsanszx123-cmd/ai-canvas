import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
const expect = baseExpect.configure({ timeout: 30000 });
async function main() {
  const db = getDb(),
    owner = randomUUID();
  const email = `chrome-agent-${owner}@example.invalid`,
    password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await mkdir("test-results/agent", { recursive: true });
  try {
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [owner, "Chrome Agent QA", email],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), owner, "credential", await hashPassword(password)],
    );
    await page.goto("http://localhost:3000/auth/login");
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/protected/);
    const created = await page.request.post(
      "http://localhost:3000/api/projects",
      { headers: { Origin: "http://localhost:3000" }, data: {} },
    );
    assert.equal(created.status(), 200);
    const { id } = await created.json();
    await page.goto(`http://localhost:3000/canvas?projectId=${id}`);
    const mode = page.getByRole("button", { name: "选择创作模式" });
    await expect(mode).toBeEnabled();
    const snapshot = async () =>
      await (
        await page.request.get(`http://localhost:3000/api/projects/${id}`)
      ).json();
    await expect(
      page.getByText("Agent自动规划", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "选择生图模型" }),
    ).toHaveCount(0);
    const modeBounds = (await mode.boundingBox())!;
    await mode.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    assert((await menu.boundingBox())!.y < modeBounds.y);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "选择生图模型" }),
    ).toBeVisible();
    await mode.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await mode.click();
    await page.mouse.click(500, 500);
    await expect(menu).toHaveCount(0);
    await mode.click();
    await page
      .getByRole("menuitemradio", { name: "Agent", exact: true })
      .click();
    console.log(
      "PASS Chrome mode placement, upward menu, keyboard, Esc, outside close and image configuration",
    );
    const portrait = await sharp({
      create: { width: 240, height: 720, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const landscape = await sharp({
      create: { width: 640, height: 360, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    let releaseUpload!: () => void;
    const delayed = new Promise<void>((resolve) => (releaseUpload = resolve));
    await page.route(
      "**/api/uploads",
      async (route) => {
        await delayed;
        await route.continue();
      },
      { times: 1 },
    );
    await page.locator('.composer > input[type="file"]').setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: portrait,
    });
    await expect(mode).toBeDisabled();
    releaseUpload();
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(1);
    await expect(mode).toBeEnabled();
    const longName =
      "这是一份用于验证附件卡片长文件名省略以及安全文本预览的创作简报.md";
    const markdown =
      "# 创作简报\n图一红色，图二蓝色。\n<script>alert('unsafe')</script>\n[危险](javascript:alert(1))";
    await page.locator("textarea").evaluate(
      (element, { name, text }) => {
        const data = new DataTransfer();
        data.items.add(new File([text], name, { type: "text/markdown" }));
        element.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, clipboardData: data }),
        );
      },
      { name: longName, text: markdown },
    );
    await expect(
      page.getByRole("button", { name: longName, exact: true }),
    ).toBeVisible();
    assert(
      (await page.locator(".reference-row > .attachment-card").boundingBox())!
        .width <= 240,
    );
    await page.getByRole("button", { name: longName, exact: true }).click();
    const preview = page.getByRole("dialog", { name: longName });
    await expect(preview).toBeVisible();
    await expect(preview.locator("pre")).toHaveText(markdown);
    const downloadPromise = page.waitForEvent("download");
    await preview.getByRole("link", { name: "下载" }).click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    assert(downloadedPath);
    assert.equal((await readFile(downloadedPath)).toString(), markdown);
    await preview.getByRole("button", { name: "关闭附件预览" }).click();
    await page.locator(".composer").evaluate((element, bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "landscape.png", {
          type: "image/png",
        }),
      );
      element.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
    }, Array.from(landscape));
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(2);
    await expect(mode).toBeEnabled();
    await expect(page.locator(".reference-thumb")).toHaveCount(2);
    console.log(
      "PASS Chrome real upload, busy mode lock, pasted Markdown, 240px long-name card, safe preview/download and dropped image",
    );
    while (await page.getByRole("button", { name: "移除参考图" }).count())
      await page.getByRole("button", { name: "移除参考图" }).first().click();
    await page.getByRole("button", { name: "适配全部图片" }).click();
    const initial = await snapshot();
    const first = page.locator(
        `.react-flow__node[data-id="${initial.nodes[0].id}"]`,
      ),
      second = page.locator(
        `.react-flow__node[data-id="${initial.nodes[1].id}"]`,
      );
    await first.click();
    await second.click();
    await expect(page.locator(".reference-number").nth(0)).toHaveText("图一");
    await expect(page.locator(".reference-number").nth(1)).toHaveText("图二");
    const bounds = (await first.boundingBox())!;
    assert(Math.abs(bounds.height / bounds.width - 3) < 0.05);
    await first.click();
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 50,
      box.y + box.height / 2 + 25,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await snapshot()).nodes.find(
            (n: { id: string }) => n.id === initial.nodes[0].id,
          ).x,
      )
      .not.toBe(initial.nodes[0].x);
    const handle = first.locator(".image-resize-handle").last();
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 35,
      handleBox.y + handleBox.height / 2 + 105,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await snapshot()).nodes.find(
            (n: { id: string }) => n.id === initial.nodes[0].id,
          ).width,
      )
      .not.toBe(initial.nodes[0].width);
    const resized = (await snapshot()).nodes.find(
      (n: { id: string }) => n.id === initial.nodes[0].id,
    );
    assert(Math.abs(resized.height / resized.width - 3) < 0.05);
    await first.focus();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(3);
    await first.click();
    await page.locator("textarea").fill("文字编辑不会删除画布");
    await page.keyboard.press("Backspace");
    assert.equal((await snapshot()).nodes.length, 3);
    await first.click();
    await page.keyboard.press("Delete");
    await expect(first).toHaveCount(0);
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(2);
    await page.reload();
    await expect(mode).toBeEnabled();
    await expect(first).toHaveCount(0);
    assert.equal((await snapshot()).assets.length, 3);
    const copiedNode = (await snapshot()).nodes.find(
      (n: { asset_id: string }) => n.asset_id === initial.nodes[0].asset_id,
    );
    const copyLocator = page.locator(
      `.react-flow__node[data-id="${copiedNode.id}"]`,
    );
    await copyLocator.click();
    await page.keyboard.press("Backspace");
    await expect(copyLocator).toHaveCount(0);
    await page.reload();
    await expect(mode).toBeEnabled();
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(1);
    console.log(
      "PASS Chrome ordered canvas references, tight portrait bounds, drag, aspect resize, copy/paste, text edit guard, Delete/Backspace and reload persistence",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(mode).toBeVisible();
    await mode.click();
    await page
      .getByRole("menuitemradio", { name: "生图", exact: true })
      .click();
    const send = page.getByRole("button", { name: "发送并生成图片" });
    const sendBox = (await send.boundingBox())!,
      composerBox = (await page.locator(".composer").boundingBox())!;
    assert(
      sendBox.x >= composerBox.x &&
        sendBox.x + sendBox.width <= composerBox.x + composerBox.width + 1,
    );
    assert(sendBox.x + sendBox.width <= 390);
    await page.screenshot({ path: "test-results/agent/mobile-image-mode.png" });
    await mode.click();
    await page
      .getByRole("menuitemradio", { name: "Agent", exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.composer > input[type="file"]').setInputFiles([
      {
        name: "brief.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(markdown),
      },
      { name: "reference.png", mimeType: "image/png", buffer: portrait },
    ]);
    await expect(mode).toBeEnabled();
    await expect(page.getByRole("button", { name: "移除参考图" })).toHaveCount(
      2,
    );
    await page
      .locator("textarea")
      .fill(
        "请查看参考图并读取附件，仅说明颜色与构图，不要生成图片。用粗体和列表回答。",
      );
    await send.click();
    await expect(page.locator("textarea")).toHaveValue("");
    await expect(page.locator(".reference-row .reference-thumb")).toHaveCount(
      0,
    );
    await expect(page.locator(".reference-row > .attachment-card")).toHaveCount(
      0,
    );
    await expect(mode).toBeDisabled();
    await expect(page.locator(".agent-user-message")).toBeVisible();
    await expect(mode).toBeEnabled({ timeout: 120000 });
    await expect(page.locator(".agent-tool")).not.toHaveCount(0);
    await expect(page.locator(".agent-markdown")).not.toHaveCount(0);
    await expect(page.locator(".agent-thinking")).not.toHaveCount(0);
    await page.locator(".agent-tool summary").first().click();
    await expect(page.locator(".agent-tool pre").first()).toBeVisible();
    await page.screenshot({ path: "test-results/agent/conversation.png" });
    await page.reload();
    await expect(mode).toBeEnabled();
    await expect(page.locator(".agent-user-message")).toHaveCount(1);
    await expect(page.locator(".agent-tool")).not.toHaveCount(0);
    const markdownAsset = (await snapshot()).assets.find(
      (a: { mime: string }) => a.mime === "text/markdown",
    );
    await page
      .locator("textarea")
      .fill(
        `为了验证工具错误提示，请调用 view_image 查看素材 ${markdownAsset.id}，它是 Markdown；工具返回错误后解释原因，不要生成图片。`,
      );
    await send.click();
    await expect(mode).toBeEnabled({ timeout: 120000 });
    const failedTool = page.locator(".agent-tool").filter({ hasText: "失败" });
    await expect(failedTool).not.toHaveCount(0);
    await failedTool.locator("summary").first().click();
    await expect(failedTool.locator("pre").first()).toContainText(
      "素材不是图片",
    );
    console.log(
      "PASS Chrome real thinking, history restored after reload and actual tool error parameters/result expansion",
    );
    assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
    console.log(
      "PASS Chrome narrow toolbar/send bounds, immediate draft clearing, sent attachments, busy lock, real streamed Agent tools and reply",
    );
  } catch (error) {
    await page
      .screenshot({ path: "test-results/agent/failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
    const assets = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=$1",
      [owner],
    );
    for (const a of assets.rows) await deleteObject(a.object_key);
    await db.query('DELETE FROM "user" WHERE id=$1', [owner]);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error.name, error.message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exitCode = 1;
});
