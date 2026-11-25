import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  chromium,
  expect as baseExpect,
  type APIResponse,
} from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { putAsset, placeAsset, deleteObject } from "../lib/storage";
const expect = baseExpect.configure({ timeout: 30000 });

async function main() {
  const db = getDb(),
    owner = randomUUID(),
    other = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const secret = `PRIVATE-CONVERSATION-${randomUUID()}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const guest = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
  });
  const member = await browser.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const page = await guest.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function create(user: string, name: string) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO ac_projects(id,owner_id,name,agent_messages) VALUES($1,$2,$3,$4)",
      [
        id,
        user,
        name,
        JSON.stringify([
          {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            prompt: secret,
            attachmentIds: [],
            events: [],
          },
        ]),
      ],
    );
    return id;
  }
  try {
    for (const id of [owner, other])
      await db.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
        [id, "Public QA", `public-${id}@example.invalid`],
      );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), owner, "credential", await hashPassword(password)],
    );
    const first = await create(owner, "公开浏览测试A"),
      second = await create(other, "公开浏览测试B");
    const deleted = await create(owner, "已删除公开项目"),
      blank = randomUUID();
    await db.query("UPDATE ac_projects SET deleted_at=now() WHERE id=$1", [
      deleted,
    ]);
    await db.query(
      "INSERT INTO ac_projects(id,owner_id,name) VALUES($1,$2,'Empty QA')",
      [blank, owner],
    );
    const png = await sharp({
      create: { width: 320, height: 200, channels: 3, background: "#b9d9e8" },
    })
      .png()
      .toBuffer();
    const image = await putAsset(owner, first, png);
    const unattached = await putAsset(owner, first, png);
    await placeAsset(owner, first, image.id);
    const preview = await guest.request.get(
      `/api/public/assets/${image.id}/content?preview=1`,
    );
    assert.equal(preview.status(), 200);
    assert.equal((await sharp(await preview.body()).metadata()).format, "webp");
    const original = await guest.request.get(
      `/api/public/assets/${image.id}/content?download=1&preview=1`,
    );
    assert(
      (await original.body()).equals(png),
      "downloads must retain the original bytes",
    );
    assert.equal(
      (
        await guest.request.get(`/api/assets/${image.id}/content?preview=1`, {
          maxRedirects: 0,
        })
      ).status(),
      401,
    );
    assert.equal(
      (
        await guest.request.get(
          `/api/public/assets/${unattached.id}/content?preview=1`,
          { maxRedirects: 0 },
        )
      ).status(),
      404,
    );
    await db.query(
      "INSERT INTO ac_skills(id,owner_id,project_id,name,description,source,body) VALUES($1,$2,$3,'private-qa',$4,$4,$4)",
      [randomUUID(), owner, first, secret],
    );
    assert.equal((await guest.request.get("/api/projects")).status(), 401);
    for (const path of [
      `/api/projects/${first}`,
      `/api/projects/${first}/agent`,
      `/api/projects/${first}/skills`,
      `/api/assets/${image.id}/url`,
    ])
      assert.equal((await guest.request.get(path)).status(), 401, path);
    for (const [method, path, data] of [
      ["PATCH", `/api/projects/${first}`, { name: "Guest mutation" }],
      ["DELETE", `/api/projects/${first}`, {}],
      ["POST", `/api/projects/${first}/generations`, {}],
      ["PUT", `/api/projects/${first}/canvas`, {}],
    ] as const)
      assert.equal(
        (
          await guest.request.fetch(path, {
            method,
            data,
            headers: { Origin: "http://localhost:3000" },
          })
        ).status(),
        401,
      );

    const listed = new Set<string>();
    let cursor: string | null = null;
    do {
      const response: APIResponse = await guest.request.get(
        `/api/public/projects?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      assert.equal(response.status(), 200);
      const text = await response.text();
      assert(!text.includes(secret));
      assert(!text.includes(owner));
      const data: { items: { id: string }[]; nextCursor: string | null } =
        JSON.parse(text);
      for (const item of data.items) {
        assert(!listed.has(item.id));
        listed.add(item.id);
      }
      cursor = data.nextCursor;
    } while (cursor);
    assert(listed.has(first) && listed.has(second));
    assert(!listed.has(blank) && !listed.has(deleted));
    assert.equal(
      (await guest.request.get("/api/public/projects?cursor=invalid")).status(),
      422,
    );
    const detail = await guest.request.get(`/api/public/projects/${first}`);
    const detailText = await detail.text();
    assert(!detailText.includes(secret));
    assert(!detailText.includes(owner));
    assert.deepEqual(Object.keys(JSON.parse(detailText)).sort(), [
      "images",
      "project",
    ]);
    assert.equal(JSON.parse(detailText).images.length, 1);
    assert.equal(
      (
        await guest.request.get(`/api/public/assets/${unattached.id}/content`, {
          maxRedirects: 0,
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await guest.request.get(`/api/public/assets/${image.id}/content`, {
          maxRedirects: 0,
        })
      ).status(),
      307,
    );
    assert.equal(
      (await guest.request.get(`/api/public/projects/${deleted}`)).status(),
      404,
    );

    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: "全部项目", exact: true }),
    ).toBeVisible();
    const card = page.locator(
      `a.project-card[href="/canvas?projectId=${first}"]`,
    );
    await expect(card).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新建项目", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "项目操作 公开浏览测试A", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".project-delete")).toHaveCount(0);
    await card.click();
    await expect(page).toHaveURL(
      `http://localhost:3000/canvas?projectId=${first}`,
    );
    await expect(page.getByText("只读浏览", { exact: true })).toBeVisible();
    const button = page.getByRole("button", {
      name: "预览画布图片",
      exact: true,
    });
    await expect(button).toHaveCount(1);
    await expect
      .poll(() =>
        button
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(320);
    await expect(
      page.locator(".image-resize-handle,.node-resizer,.project-delete"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "生图提示词", exact: true }),
    ).toBeVisible();
    await page.locator(".react-flow__node-publicImage").click();
    await expect(
      page.getByRole("toolbar", { name: "图片操作", exact: true }),
    ).toBeVisible();
    const before = (
      await db.query("SELECT x,y FROM ac_nodes WHERE asset_id=$1", [image.id])
    ).rows[0];
    const box = await button.boundingBox();
    assert(box);
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
    await page.mouse.up();
    assert.deepEqual(
      (await db.query("SELECT x,y FROM ac_nodes WHERE asset_id=$1", [image.id]))
        .rows[0],
      before,
    );
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
    const download = page
      .getByRole("dialog", { name: "图片预览" })
      .getByRole("link", { name: "下载预览图片", exact: true });
    await expect(download).toBeVisible();
    assert.equal(
      (
        await guest.request.get(
          (await download.getAttribute("href")) as string,
          { maxRedirects: 0 },
        )
      ).status(),
      307,
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const imageBox = await page
          .locator(".react-flow__node-publicImage")
          .boundingBox();
        return (
          !!imageBox && imageBox.x >= 0 && imageBox.x + imageBox.width <= 390
        );
      })
      .toBe(true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await mkdir("test-results/public-projects", { recursive: true });
    await page.screenshot({ path: "test-results/public-projects/mobile.png" });
    for (const action of [
      "快捷编辑",
      "变清晰",
      "换背景",
      "拆分元素",
      "画同款",
    ]) {
      await page.goto(`/canvas?projectId=${first}`);
      await page.locator(".react-flow__node-publicImage").click();
      await page
        .getByRole("toolbar", { name: "图片操作", exact: true })
        .getByRole("button", { name: action, exact: true })
        .click();
      await expect(page).toHaveURL(/\/auth\/login\?next=/);
      assert.equal(
        new URL(page.url()).searchParams.get("next"),
        `/canvas?projectId=${first}`,
      );
    }
    await page.goto(`/canvas?projectId=${first}`);
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await page
      .getByRole("textbox", { name: "生图提示词", exact: true })
      .fill("游客只测试登录入口，不执行生成");
    await page
      .getByRole("button", { name: "发送并生成图片", exact: true })
      .click();
    await expect(page).toHaveURL(/\/auth\/login\?next=/);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ac_tasks WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
      0,
    );
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(`public-${owner}@example.invalid`);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(
      `http://localhost:3000/canvas?projectId=${first}`,
    );
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await page
      .getByRole("button", { name: "适配全部图片", exact: true })
      .click();
    await page.locator(".react-flow__node-image").click();
    await page
      .getByRole("toolbar", { name: "图片操作", exact: true })
      .getByRole("button", { name: "快捷编辑", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "图片快捷编辑", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "关闭图片编辑", exact: true })
      .click();
    await page.goto(`/explore/${second}`);
    await expect(
      page.getByText("这个项目暂时没有画布图片", { exact: true }),
    ).toBeVisible();

    assert.equal(
      (
        await member.request.post("/api/auth/sign-in/email", {
          data: { email: `public-${owner}@example.invalid`, password },
        })
      ).status(),
      200,
    );
    const own = await (await member.request.get("/api/projects")).json();
    assert(own.items.some((item: { id: string }) => item.id === first));
    assert(!own.items.some((item: { id: string }) => item.id === second));
    assert.equal(
      (
        await member.request.patch(`/api/projects/${second}`, {
          data: { name: "Foreign mutation" },
        })
      ).status(),
      404,
    );
    await db.query("UPDATE ac_projects SET deleted_at=now() WHERE id=$1", [
      first,
    ]);
    assert.equal(
      (await guest.request.get(`/api/public/projects/${first}`)).status(),
      404,
    );
    assert.equal(
      (
        await guest.request.get(`/api/public/assets/${image.id}/content`, {
          maxRedirects: 0,
        })
      ).status(),
      404,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "PASS public cross-user list/pagination, canvas images, preview/download, keyboard/mobile, hidden drafts/deleted records, no private history/Skill/attachment access, guest write denial and member ownership; no generation requests.",
    );
  } catch (error) {
    console.error("Public canvas QA path", new URL(page.url()).pathname);
    console.error(
      "Page error state",
      await page.locator(".workspace-error,.inline-error").allTextContents(),
    );
    await mkdir("test-results/public-projects", { recursive: true });
    await page
      .screenshot({ path: "test-results/public-projects/failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
    const assets = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=ANY($1::uuid[])",
      [[owner, other]],
    );
    for (const asset of assets.rows) await deleteObject(asset.object_key);
    await db.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
      [owner, other],
    ]);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error.name, error.message.replace(/https?:\/\/\S+/g, "[url]"));
  console.error(
    error.stack
      ?.split("\n")
      .find((line: string) => line.includes("public-projects.ts")),
  );
  process.exitCode = 1;
});
