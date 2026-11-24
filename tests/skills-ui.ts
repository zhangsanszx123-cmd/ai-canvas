import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
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

    const file = await readFile("docs/skills/wechat-cover/SKILL.md");
    const picker = page.getByRole("button", {
      name: "选择 Skill",
      exact: true,
    });
    await expect(picker).toBeVisible();
    await picker.click();
    await page
      .getByLabel("上传 Skill 文件")
      .setInputFiles({
        name: "SKILL.md",
        mimeType: "text/markdown",
        buffer: file,
      });
    await expect(page.locator(".skill-select")).toHaveCount(1);
    const description = page.locator(".skill-description");
    assert((await description.boundingBox())!.height <= 37);
    await page.locator(".skill-select").click();
    await picker.click();
    await page.locator(".skill-select").click();
    await expect(page.locator(".selected-skill")).toContainText("wechat-cover");
    const article =
      "# 专注边界\n\n会议过多打断远程工作的专注。\n\n建议用文档异步沟通，保留必要的实时决策。\n\n最后要明确同步与异步的边界，而不是消灭全部会议。";
    await page
      .locator('.composer > input[type="file"]')
      .setInputFiles({
        name: "article.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(article),
      });
    await expect(page.getByRole("button", { name: "移除参考图" })).toHaveCount(
      1,
    );
    await page.locator("textarea").fill("用本次技能帮文章设计公众号封面。");
    await page.getByRole("button", { name: "发送并生成图片" }).click();
    await expect(page.locator("textarea")).toHaveValue("");
    await expect(page.locator(".selected-skill")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "移除参考图" })).toHaveCount(
      0,
    );
    await expect(page.locator(".agent-user-message .sent-skill")).toHaveText(
      "Skill · wechat-cover",
    );
    await expect(mode).toBeEnabled({ timeout: 120000 });
    await expect(page.locator(".agent-markdown").last()).toContainText(
      "孟菲斯",
    );
    const snapshot = await (
      await page.request.get("http://localhost:3000/api/projects/" + id)
    ).json();
    assert.equal(snapshot.tasks.length, 0);
    await page.reload();
    await expect(mode).toBeEnabled();
    await expect(page.locator(".sent-skill")).toHaveText(
      "Skill · wechat-cover",
    );
    await expect(page.locator(".selected-skill")).toHaveCount(0);
    await picker.click();
    await page.getByRole("button", { name: "移除技能 wechat-cover" }).click();
    await expect(page.locator(".skill-select")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".sent-skill")).toHaveText(
      "Skill · wechat-cover",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await picker.click();
    await expect(page.locator(".skill-menu")).toBeVisible();
    await page.screenshot({ path: "test-results/agent/skills-mobile.png" });
    await page.keyboard.press("Escape");
    assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
    console.log(
      "PASS Chrome Skill upload/list/two-line description, choose/remove, immediate draft and Skill reset, saved message name, real style question and mobile menu",
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
