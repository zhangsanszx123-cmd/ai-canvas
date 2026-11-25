import { strict as assert } from "node:assert";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  try {
    await page.goto("http://localhost:3000/");
    await expect(page).toHaveURL("http://localhost:3000/");
    await expect(
      page.getByRole("link", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "选择创作模式" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "选择 Skill", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新建项目", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".project-delete")).toHaveCount(0);
    assert.equal(
      (
        await page.request.get("http://localhost:3000/api/public/projects")
      ).status(),
      200,
    );
    assert.equal(
      (await page.request.get("http://localhost:3000/api/projects")).status(),
      401,
    );
    assert.equal(
      (
        await page.request.post("http://localhost:3000/api/projects", {
          headers: { Origin: "http://localhost:3000" },
          data: {},
        })
      ).status(),
      401,
    );
    await page.goto("http://localhost:3000/protected");
    await expect(
      page.getByRole("button", { name: "选择创作模式" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/protected/);
    await page.goto("http://localhost:3000/projects");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByRole("heading", { name: "全部项目", exact: true }),
    ).toBeVisible();
    await page.goto("http://localhost:3000/");
    await page.locator("textarea").fill("游客测试，不创建生成任务");
    await page.getByRole("button", { name: "发送并生成图片" }).click();
    await expect(page).toHaveURL(/auth\/login/);
    await page.goto("http://localhost:3000/");
    await page.getByRole("button", { name: "选择 Skill", exact: true }).click();
    await expect(page).toHaveURL(/auth\/login/);
    await page.goto("http://localhost:3000/");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("link", { name: "登录", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    console.log(
      "PASS Chrome anonymous home, legacy home and project list, visible Agent/Skill, read-only guest controls, private API protection, send/Skill login gate and mobile bounds",
    );
  } finally {
    await browser.close();
  }
}
void main().catch((e) => {
  console.error(e.name, e.message);
  process.exitCode = 1;
});
