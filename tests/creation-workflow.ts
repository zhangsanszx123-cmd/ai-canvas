import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
const expect = baseExpect.configure({ timeout: 30000 });
const source = (name: string) =>
  Buffer.from(
    `---\nname: ${name}\ndescription: 海报创作测试规则，可在多个项目复用\n---\n# 创作规则\n只回答 ACCOUNT_SKILL_READY，不调用任何工具，不生成图片。\n\n<script>throw new Error('unsafe')</script>`,
  );
async function main() {
  const db = getDb(),
    owner = randomUUID(),
    foreign = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const other = await browser.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const guest = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    for (const id of [owner, foreign]) {
      await db.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
        [id, "Creation QA", `${id}@example.invalid`],
      );
      await db.query(
        'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
        [randomUUID(), id, "credential", await hashPassword(password)],
      );
    }
    for (const [client, id] of [
      [context.request, owner],
      [other.request, foreign],
    ] as const)
      assert.equal(
        (
          await client.post("/api/auth/sign-in/email", {
            data: { email: `${id}@example.invalid`, password },
          })
        ).status(),
        200,
      );
    assert.equal((await guest.request.get("/api/skills")).status(), 401);
    const skillsLoaded = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/skills") &&
        response.request().method() === "GET",
    );
    await page.goto("/skills");
    await skillsLoaded;
    await expect(
      page.getByRole("heading", { name: "我的技能库", exact: true }),
    ).toBeVisible();
    await page.getByLabel("导入账号 Skill 文件").setInputFiles({
      name: "SKILL.md",
      mimeType: "text/markdown",
      buffer: source("account-qa"),
    });
    await expect(page.locator(".skill-library-card")).toHaveCount(1);
    const skill = (await (await context.request.get("/api/skills")).json())
      .items[0];
    assert.equal(skill.scope, "account");
    await page.getByRole("button", { name: "查看规则", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "技能规则", exact: true });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("ACCOUNT_SKILL_READY");
    await expect(detail.locator("script")).toHaveCount(0);
    await page
      .getByRole("button", { name: "关闭技能详情", exact: true })
      .click();
    assert.equal(
      (await other.request.get(`/api/skills/${skill.id}`)).status(),
      404,
    );
    assert.equal(
      (await other.request.delete(`/api/skills/${skill.id}`)).status(),
      404,
    );
    assert.equal(
      (
        await context.request.post("/api/skills", {
          multipart: {
            file: {
              name: "SKILL.md",
              mimeType: "text/markdown",
              buffer: source("account-qa"),
            },
          },
        })
      ).status(),
      409,
    );
    await page.getByLabel("搜索账号技能").fill("不匹配");
    await expect(page.locator(".skill-library-card")).toHaveCount(0);
    await page.goto("/");
    await page.getByRole("button", { name: "选择 Skill", exact: true }).click();
    await expect(page.locator(".skill-select")).toHaveCount(1);
    await page.keyboard.press("Escape");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ac_projects WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
      0,
    );
    const textarea = page.getByRole("textbox", {
      name: "生图提示词",
      exact: true,
    });
    await textarea.fill("设计海报 /account");
    await expect(page.getByRole("listbox", { name: "技能建议" })).toBeVisible();
    await textarea.press("Enter");
    await expect(
      page.getByRole("button", { name: "取消本次 Skill", exact: true }),
    ).toContainText("account-qa");
    await expect(textarea).toHaveValue("设计海报 ");
    const first = await (
      await context.request.post("/api/projects", { data: {} })
    ).json();
    const second = await (
      await context.request.post("/api/projects", { data: {} })
    ).json();
    const local = await context.request.post(
      `/api/projects/${first.id}/skills`,
      {
        multipart: {
          file: {
            name: "SKILL.md",
            mimeType: "text/markdown",
            buffer: source("project-qa"),
          },
        },
      },
    );
    assert.equal(local.status(), 200);
    const localSkill = await local.json();
    const projectSkills = (
      await (
        await context.request.get(`/api/projects/${second.id}/skills`)
      ).json()
    ).items;
    assert(projectSkills.some((s: { id: string }) => s.id === skill.id));
    assert(!projectSkills.some((s: { id: string }) => s.id === localSkill.id));
    assert.equal(
      (
        await context.request.get(
          `/api/projects/${second.id}/skills/${localSkill.id}`,
        )
      ).status(),
      404,
    );
    assert.equal(
      (
        await context.request.get(
          `/api/projects/${second.id}/skills/${skill.id}`,
        )
      ).status(),
      200,
    );
    assert.equal(
      (
        await context.request.delete(
          `/api/projects/${first.id}/skills/${skill.id}`,
        )
      ).status(),
      404,
    );
    const png = await sharp({
      create: { width: 200, height: 120, channels: 3, background: "#c4d9c6" },
    })
      .png()
      .toBuffer();
    const uploaded = await context.request.post("/api/uploads", {
      multipart: {
        projectId: first.id,
        file: { name: "reference.png", mimeType: "image/png", buffer: png },
      },
    });
    assert.equal(uploaded.status(), 200);
    await context.request.post("/api/uploads", {
      multipart: {
        projectId: first.id,
        file: {
          name: "brief.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("# 素材简报\n只测试引用，不生成图片。"),
        },
      },
    });
    await page.goto(`/canvas?projectId=${first.id}`);
    await expect(
      page.getByRole("button", { name: "选择创作模式", exact: true }),
    ).toBeEnabled();
    await textarea.fill("参考 @reference");
    await expect(
      page.getByRole("listbox", { name: "参考素材建议" }),
    ).toBeVisible();
    await textarea.press("Enter");
    await expect(page.locator(".composer .reference-thumb")).toHaveCount(1);
    await textarea.fill("继续 @reference");
    await textarea.press("Enter");
    await expect(page.locator(".composer .reference-thumb")).toHaveCount(1);
    await textarea.fill("加文档 @brief");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option").click();
    await expect(
      page.locator(".composer .attachment-card").first(),
    ).toContainText("brief.md");
    await textarea.fill("/不存在");
    await expect(
      page.getByText("没有匹配的技能，可从 Skill 按钮上传或前往技能库导入", {
        exact: true,
      }),
    ).toBeVisible();
    await textarea.press("Control+Enter");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
      0,
    );
    await textarea.press("Escape");
    await expect(page.locator(".composer-command-menu")).toHaveCount(0);
    await textarea.fill("");
    await page
      .locator(".composer .reference-thumb")
      .getByRole("button", { name: "移除参考图", exact: true })
      .click();
    await page.locator(".react-flow__node-image").first().click();
    await expect(page.locator(".composer .reference-thumb")).toHaveCount(1);
    await page.locator(".react-flow__node-image").first().click();
    await expect(page.locator(".composer .reference-thumb")).toHaveCount(1);

    // A real Agent call verifies account skill resolution; the skill forbids image generation.
    const run = await context.request.post(`/api/projects/${second.id}/agent`, {
      data: {
        prompt: "按所选技能只输出确认标记，不调用工具，不生成图片。",
        skillId: skill.id,
      },
      timeout: 120000,
    });
    assert.equal(run.status(), 200);
    const events = (await run.text())
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));
    assert(
      !events.some((event: { type: string }) => event.type === "error"),
      "Agent must complete without an error event",
    );
    assert(
      events
        .filter((event: { type: string }) => event.type === "text_delta")
        .map((event: { delta: string }) => event.delta)
        .join("")
        .includes("ACCOUNT_SKILL_READY"),
    );
    const history = await (
      await context.request.get(`/api/projects/${second.id}/agent`)
    ).json();
    assert.deepEqual(history.messages.at(-1).skillNames, ["account-qa"]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
      0,
    );
    await context.request.patch(`/api/projects/${first.id}`, {
      data: { name: "待重命名项目" },
    });
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "项目操作 待重命名项目", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "重命名项目 待重命名项目", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "项目名称", exact: true })
      .fill("改名后的创作项目");
    await page.getByRole("button", { name: "保存名称", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "重命名项目", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.locator(`a[href="/canvas?projectId=${first.id}"]`),
    ).toContainText("改名后的创作项目");
    assert.equal(
      (
        await other.request.patch(`/api/projects/${first.id}`, {
          data: { name: "Foreign rename" },
        })
      ).status(),
      404,
    );
    await page.goto("/skills");
    await page
      .getByRole("button", { name: "删除账号技能 account-qa", exact: true })
      .click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator(".skill-library-card")).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await mkdir("test-results/creation-workflow", { recursive: true });
    await page.screenshot({
      path: "test-results/creation-workflow/skills-mobile.png",
    });
    await page
      .getByRole("button", { name: "删除账号技能 account-qa", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认删除技能", exact: true })
      .click();
    await expect(page.locator(".skill-library-card")).toHaveCount(0);
    assert.equal(
      (
        await context.request.get(
          `/api/projects/${second.id}/skills/${skill.id}`,
        )
      ).status(),
      404,
    );
    await page.goto(`/canvas?projectId=${first.id}`);
    await expect(
      page.getByRole("button", { name: "选择创作模式", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "选择 Skill", exact: true }).click();
    await page
      .getByRole("button", { name: "加入账号技能库 project-qa", exact: true })
      .click();
    await expect(page.locator(".skill-select")).toHaveCount(2);
    const copied = (await (await context.request.get("/api/skills")).json())
      .items[0];
    assert.equal(copied.name, "project-qa");
    assert.equal(
      (
        await context.request.get(
          `/api/projects/${second.id}/skills/${copied.id}`,
        )
      ).status(),
      200,
    );
    assert.equal(
      (
        await context.request.post(
          `/api/projects/${first.id}/skills/${localSkill.id}/library`,
          { data: {} },
        )
      ).status(),
      409,
    );
    assert.equal(
      (
        await other.request.post(
          `/api/projects/${first.id}/skills/${localSkill.id}/library`,
          { data: {} },
        )
      ).status(),
      404,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "PASS account skill import/search/details/delete, project reuse and scope, real Agent skill use without image generation, shortcut keyboard/reference dedupe, canvas selection, rename persistence, mobile, guest/foreign isolation.",
    );
  } catch (error) {
    await mkdir("test-results/creation-workflow", { recursive: true });
    await page
      .screenshot({ path: "test-results/creation-workflow/failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
    const assets = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=ANY($1::uuid[])",
      [[owner, foreign]],
    );
    for (const asset of assets.rows) await deleteObject(asset.object_key);
    await db.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
      [owner, foreign],
    ]);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(
    error.name,
    error.message.replace(/https?:\/\/\S+/g, "[url]"),
    error.stack
      ?.split("\n")
      .find((line: string) => line.includes("creation-workflow.ts")),
  );
  process.exitCode = 1;
});
