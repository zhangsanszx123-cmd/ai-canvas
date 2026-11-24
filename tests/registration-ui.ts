import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect, type Page } from "@playwright/test";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
const expect = baseExpect.configure({ timeout: 30000 });
async function checkImagePreview(page: Page) {
  const db = getDb();
  const projectId = new URL(page.url()).searchParams.get("projectId")!;
  const asset = (
    await db.query(
      "SELECT * FROM ac_assets WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
      [projectId],
    )
  ).rows[0];
  const taskId = randomUUID(),
    nodeId = randomUUID();
  // The upload flow now creates a node; isolate the preview fixture's geometry.
  await db.query("DELETE FROM ac_nodes WHERE project_id=$1 AND task_id IS NULL", [projectId]);
  await db.query(
    "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,config,idempotency_key,request_hash,status,results) VALUES($1,$2,$3,'Preview QA',$4,$5,'test','completed',$6)",
    [
      taskId,
      projectId,
      asset.owner_id,
      { model: "gpt-image-2", size: "1:1", resolution: "1k", n: 1 },
      randomUUID(),
      JSON.stringify([{ assetId: asset.id }]),
    ],
  );
  await db.query(
    "INSERT INTO ac_nodes(id,project_id,task_id,asset_id,width,height) VALUES($1,$2,$3,$4,480,320)",
    [nodeId, projectId, taskId, asset.id],
  );
  await page.reload();
  const canvasNode = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  await expect(canvasNode.locator("img")).toBeVisible();
  await page.getByRole("button", { name: "适配全部图片" }).click();
  await canvasNode.click();
  await page.getByRole("button", { name: "放大画布图片" }).click();
  const dialog = page.getByRole("dialog", { name: "图片预览" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "按原始尺寸查看" }).click();
  await expect(dialog.locator("output")).toHaveText("100%");
  await dialog.getByRole("button", { name: "放大预览图片" }).click();
  await expect(dialog.locator("output")).toHaveText("125%");
  await dialog.getByRole("button", { name: "缩小预览图片" }).click();
  await expect(dialog.locator("output")).toHaveText("100%");
  for (let i = 0; i < 5; i++)
    await dialog.getByRole("button", { name: "放大预览图片" }).click();
  const stage = dialog.getByLabel("图片查看区域");
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 120,
    bounds.y + bounds.height / 2 - 70,
  );
  await page.mouse.up();
  expect(await stage.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("0");
  await page.keyboard.press("+");
  await expect(dialog.locator("output")).toHaveText("125%");
  await page.screenshot({ path: "test-results/image-preview-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const viewportBeforePreview = await page
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await canvasNode.dblclick();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  expect(
    await page.locator(".react-flow__viewport").getAttribute("style"),
  ).toBe(viewportBeforePreview);
  await page.getByRole("button", { name: "查看大图", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("output")).toHaveText("100%");
  await page.setViewportSize({ width: 390, height: 640 });
  await dialog.getByRole("button", { name: "适应预览窗口" }).click();
  await expect
    .poll(() =>
      dialog
        .locator("img")
        .evaluate((img) => img.getBoundingClientRect().width),
    )
    .toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/image-preview-mobile.png" });
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(canvasNode).toBeVisible();
  await page.getByRole("button", { name: "适配全部图片" }).click();
  await canvasNode.click();
  await expect(canvasNode.locator(".image-resize-handle")).toHaveCount(4);
  const readGeometry = async () =>
    (
      await db.query("SELECT x,y,width,height FROM ac_nodes WHERE id=$1", [
        nodeId,
      ])
    ).rows[0] as { x: number; y: number; width: number; height: number };
  const initialGeometry = await readGeometry();
  let geometry = initialGeometry;
  for (const [index, corner] of [
    "bottom.right",
    "top.left",
    "top.right",
    "bottom.left",
  ].entries()) {
    const handle = canvasNode.locator(`.image-resize-handle.${corner}`);
    const rect = (await handle.boundingBox())!;
    const priorWidth = geometry.width;
    const grow = index < 2;
    const dx = (corner.endsWith("right") ? 1 : -1) * (grow ? 60 : -40);
    const dy = (corner.startsWith("bottom") ? 1 : -1) * (grow ? 40 : -27);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + dx,
      rect.y + rect.height / 2 + dy,
      { steps: 8 },
    );
    if (index === 0) {
      // Keep dragging across a polling cycle; server snapshots must not reset the size.
      const during = (await canvasNode.boundingBox())!.width;
      await page.waitForTimeout(5500);
      expect((await canvasNode.boundingBox())!.width).toBeCloseTo(during, 0);
    }
    await page.mouse.up();
    await expect
      .poll(async () => {
        const saved = await readGeometry();
        return grow ? saved.width > priorWidth : saved.width < priorWidth;
      })
      .toBe(true);
    geometry = await readGeometry();
    expect(geometry.width / geometry.height).toBeCloseTo(
      initialGeometry.width / initialGeometry.height,
      1,
    );
  }
  await page.screenshot({ path: "test-results/canvas-corner-resize.png" });
  await page.reload();
  await expect(canvasNode).toBeVisible();
  const restored = await page.request.get(
    `${new URL(page.url()).origin}/api/projects/${projectId}`,
  );
  const restoredNode = (await restored.json()).nodes.find(
    (node: { id: string }) => node.id === nodeId,
  );
  expect(restoredNode.width).toBe(geometry.width);
  expect(restoredNode.height).toBe(geometry.height);
  expect(restoredNode.x).toBe(geometry.x);
  expect(restoredNode.y).toBe(geometry.y);
  const state = (
    await db.query("SELECT version,viewport FROM ac_projects WHERE id=$1", [
      projectId,
    ])
  ).rows[0];
  const invalid = await page.request.put(
    `${new URL(page.url()).origin}/api/projects/${projectId}/canvas`,
    {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        version: state.version,
        viewport: state.viewport,
        nodes: [
          {
            id: nodeId,
            x: geometry.x,
            y: geometry.y,
            width: -1,
            height: geometry.height,
          },
        ],
      },
    },
  );
  expect(invalid.status()).toBe(422);
  expect(await readGeometry()).toEqual(geometry);
  console.log(
    "PASS four corner resizing: enlarge/shrink, locked aspect ratio, polling stability, saved size/position after refresh and invalid-size rejection",
  );
  console.log(
    "PASS image preview: canvas button/double-click/chat entry, zoom, original size, fit, drag, Escape, close, mobile and unchanged canvas",
  );
}
async function checkFailedNodeDeletion(page: Page) {
  const db = getDb();
  const projectId = new URL(page.url()).searchParams.get("projectId")!;
  const project = (
    await db.query("SELECT owner_id FROM ac_projects WHERE id=$1", [projectId])
  ).rows[0];
  const fixtures: { nodeId: string; taskId: string; status: string }[] = [];
  for (const [index, status] of [
    "failed",
    "failed",
    "failed",
    "submission_unknown",
    "completed",
  ].entries()) {
    const nodeId = randomUUID(),
      taskId = randomUUID();
    await db.query(
      "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,config,idempotency_key,request_hash,status,error) VALUES($1,$2,$3,$4,$5,$6,'test',$7,'Deletion QA error')",
      [
        taskId,
        projectId,
        project.owner_id,
        `Deletion QA ${index}`,
        { model: "gpt-image-2", size: "1:1", resolution: "1k", n: 1 },
        randomUUID(),
        status,
      ],
    );
    await db.query(
      "INSERT INTO ac_nodes(id,project_id,task_id,x,y,width,height) VALUES($1,$2,$3,$4,80,180,120)",
      [nodeId, projectId, taskId, 80 + index * 220],
    );
    fixtures.push({ nodeId, taskId, status });
  }
  const origin = new URL(page.url()).origin;
  const path = (nodeId: string) =>
    `${origin}/api/projects/${projectId}/nodes/${nodeId}`;
  const headers = { Origin: origin };
  for (const fixture of fixtures.slice(3)) {
    expect(
      (await page.request.delete(path(fixture.nodeId), { headers })).status(),
    ).toBe(409);
  }
  expect(
    (await page.request.delete(path(randomUUID()), { headers })).status(),
  ).toBe(404);
  const foreignOwner = randomUUID(),
    foreignProject = randomUUID(),
    foreignTask = randomUUID(),
    foreignNode = randomUUID();
  await db.query(
    'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Deletion QA\',$2,false)',
    [foreignOwner, `qa-delete-${foreignOwner}@example.invalid`],
  );
  try {
    await db.query(
      "INSERT INTO ac_projects(id,owner_id,name) VALUES($1,$2,'Deletion QA')",
      [foreignProject, foreignOwner],
    );
    await db.query(
      "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,config,idempotency_key,request_hash,status) VALUES($1,$2,$3,'Deletion QA','{}',$4,'test','failed')",
      [foreignTask, foreignProject, foreignOwner, randomUUID()],
    );
    await db.query(
      "INSERT INTO ac_nodes(id,project_id,task_id) VALUES($1,$2,$3)",
      [foreignNode, foreignProject, foreignTask],
    );
    expect(
      (
        await page.request.delete(
          `${origin}/api/projects/${foreignProject}/nodes/${foreignNode}`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      (await page.request.delete(path(foreignNode), { headers })).status(),
    ).toBe(404);
    expect(
      (await db.query("SELECT id FROM ac_nodes WHERE id=$1", [foreignNode]))
        .rowCount,
    ).toBe(1);
  } finally {
    await db.query('DELETE FROM "user" WHERE id=$1', [foreignOwner]);
  }
  await page.reload();
  const node = (index: number) =>
    page.locator(`.react-flow__node[data-id="${fixtures[index].nodeId}"]`);
  await expect(node(0)).toBeVisible();
  await page.getByRole("button", { name: "适配全部图片" }).click();
  await node(0).click();
  await page.route(path(fixtures[0].nodeId), (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "模拟删除失败" } }),
    }),
  );
  await page.getByRole("button", { name: "删除失败占位" }).click();
  await expect(page.locator(".chat-composer .inline-error")).toContainText(
    "模拟删除失败",
  );
  await expect(node(0)).toHaveCount(1);
  expect(
    (
      await db.query("SELECT id FROM ac_nodes WHERE id=$1", [
        fixtures[0].nodeId,
      ])
    ).rowCount,
  ).toBe(1);
  await page.unroute(path(fixtures[0].nodeId));
  await page.screenshot({ path: "test-results/failed-node-delete.png" });
  await page.getByRole("button", { name: "删除失败占位" }).click();
  await expect(node(0)).toHaveCount(0);
  expect(
    (await page.request.delete(path(fixtures[0].nodeId), { headers })).status(),
  ).toBe(404);
  await node(1).click();
  const prompt = page.getByRole("textbox", { name: "生图提示词" });
  await prompt.fill("draft");
  await prompt.press("Backspace");
  await expect(node(1)).toHaveCount(1);
  await node(1).focus();
  await page.keyboard.press("Delete");
  await expect(node(1)).toHaveCount(0);
  await node(2).click();
  await node(2).focus();
  await page.keyboard.press("Backspace");
  await expect(node(2)).toHaveCount(0);
  await page.reload();
  for (let index = 0; index < 3; index++) {
    await expect(node(index)).toHaveCount(0);
    await expect(
      page.getByText(`Deletion QA ${index}`, { exact: true }),
    ).toBeVisible();
    expect(
      (
        await db.query("SELECT id FROM ac_tasks WHERE id=$1", [
          fixtures[index].taskId,
        ])
      ).rowCount,
    ).toBe(1);
  }
  // Remove only this test's remaining fixtures to restore its empty canvas.
  await db.query("DELETE FROM ac_tasks WHERE id=ANY($1::uuid[])", [
    fixtures.map((f) => f.taskId),
  ]);
  await page.reload();
  await expect(page.locator(".image-node")).toHaveCount(0);
  console.log(
    "PASS failed placeholders: button/Delete/Backspace, deletion failure recovery, refresh persistence, retained messages, input safety, ownership and status restrictions",
  );
}
async function checkImageConfig(page: Page, location: string) {
  if(await page.getByRole("button",{name:"选择创作模式"}).count()){
    await page.getByRole("button",{name:"选择创作模式"}).click();
    await page.getByRole("menuitemradio",{name:"生图",exact:true}).click();
  }
  for (const viewport of [
    { width: 1024, height: 406 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "配置图片参数" }).click();
    const dialog = page.getByRole("dialog", { name: "GPT Image2 图片配置" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(7);
    expect(bounds!.y).toBeGreaterThanOrEqual(7);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 7);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 7);
    expect(await dialog.evaluate((el) => el.matches(":popover-open"))).toBe(
      true,
    );
    await dialog.getByRole("button", { name: "2K", exact: true }).click();
    await dialog.getByRole("button", { name: "16:9", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "2K", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "4K", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "16:9", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "配置图片参数" }),
    ).toContainText("16:9 · 4K");
    await page.screenshot({
      path: `test-results/config-${location}-${viewport.width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function main() {
  const base =
    process.argv[2] || process.env.APP_URL || "http://localhost:3000";
  const email = `qa-ui-${randomUUID()}@example.invalid`;
  const password = randomBytes(20).toString("base64url");
  const db = getDb();
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    await mkdir("test-results", { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (
        ["error", "warning"].includes(message.type()) &&
        /uncached data|blocking-prerender-dynamic|encountered uncached/i.test(
          message.text(),
        )
      )
        errors.push(message.text());
    });
    await page.goto(`${base}/auth/sign-up`);
    await expect(page.getByRole("button", { name: "创建账号" })).toBeEnabled();
    await page.screenshot({ path: "test-results/signup.png" });
    await page
      .locator(".auth-card:visible")
      .getByLabel("昵称")
      .fill("QA browser creator");
    await page
      .locator(".auth-card:visible")
      .getByLabel("邮箱", { exact: true })
      .fill(email);
    await page
      .locator(".auth-card:visible")
      .getByLabel("密码", { exact: true })
      .fill(password);
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page).toHaveURL(`${base}/protected`);
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
    await checkImageConfig(page, "home");
    console.log(
      "PASS browser signup automatically logs in without email verification",
    );
    await page.getByRole("link", { name: "我的项目" }).click();
    await expect(page).toHaveURL(`${base}/projects`);
    await expect(
      page.getByRole("heading", { name: "项目", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "返回创作首页" }).click();
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
    await page.getByRole("link", { name: "查看全部" }).click();
    await expect(
      page.getByRole("heading", { name: "项目", exact: true }),
    ).toBeVisible();
    console.log(
      "PASS client-side links between home and projects keep authentication within route Suspense boundaries",
    );
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await expect(page).toHaveURL(/\/canvas\?projectId=/);
    await page.getByRole("button", { name: "选择创作模式" }).click();
    await page
      .getByRole("menuitemradio", { name: "生图", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "配置图片参数" }),
    ).toBeVisible();
    await checkImageConfig(page, "canvas");
    await checkFailedNodeDeletion(page);
    await page.getByRole("button", { name: "附件", exact: true }).click();
    await page.getByRole("button", { name: "从画布选择", exact: true }).click();
    await expect(page.locator(".chat-composer .inline-error")).toContainText(
      "还没有可选择",
    );
    const image = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#9ca9a6" },
    })
      .png()
      .toBuffer();
    await page.locator(".composer > input[type=file]").setInputFiles({
      name: "browser-reference.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(page.locator(".reference-thumb img")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".reference-thumb img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({ path: "test-results/canvas-uploaded.png" });
    console.log(
      "PASS browser new-project flow and real single-reference upload",
    );
    await page.getByRole("button", { name: "移除参考图" }).click();
    await expect(page.locator(".reference-thumb")).toHaveCount(0);
    await checkImagePreview(page);
    await page.getByRole("link", { name: "返回首页" }).click();
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
    await page.locator("a.project-card").first().click();
    await expect(page).toHaveURL(/\/canvas\?projectId=/);
    await expect(page.locator(".workspace")).toBeVisible();
    await page.getByRole("button", { name: "选择创作模式" }).click();
    await page
      .getByRole("menuitemradio", { name: "生图", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "配置图片参数" }),
    ).toBeVisible();
    console.log(
      "PASS client-side project-card navigation opens the authenticated canvas",
    );
    await page.goto(`${base}/canvas?projectId=${"-".repeat(36)}`);
    await expect(
      page.getByRole("heading", { name: "页面或项目不存在" }),
    ).toBeVisible();
    console.log("PASS malformed project ID shows not-found UI");
    await page.goto(`${base}/protected`);
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(`${base}/auth/login`);
    await page.getByRole("link", { name: "忘记密码？" }).click();
    await expect(page.getByRole("heading", { name: "找回密码" })).toBeVisible();
    await page.getByRole("link", { name: "返回登录" }).click();
    await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
    await page
      .locator(".auth-card:visible")
      .getByLabel("邮箱", { exact: true })
      .fill(email);
    await page
      .locator(".auth-card:visible")
      .getByLabel("密码", { exact: true })
      .fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(`${base}/protected`);
    console.log("PASS browser logout and password login");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    const users = await db.query('SELECT id FROM "user" WHERE email=$1', [
      email,
    ]);
    if (users.rows[0]) {
      const files = await db.query(
        "SELECT object_key FROM ac_assets WHERE owner_id=$1",
        [users.rows[0].id],
      );
      for (const f of files.rows)
        await deleteObject(f.object_key).catch(() => {});
      await db.query('DELETE FROM "user" WHERE email=$1', [email]);
    }
    await db.end();
  }
}
main().catch((e) => {
  console.error(
    "BROWSER REGISTRATION CHECK FAILED",
    e instanceof Error ? e.message : "Unknown error",
  );
  process.exitCode = 1;
});
