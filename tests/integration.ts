import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, request, expect as baseExpect } from "@playwright/test";
import sharp from "sharp";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db";
import { tick } from "../lib/worker";
import { deleteObject } from "../lib/storage";
import { defaultConfig, NANO_MODEL, providerPayload } from "../lib/models";
const expect = baseExpect.configure({ timeout: 30000 });

async function main() {
  const baseURL =
    process.argv[2] || process.env.APP_URL || "http://localhost:3000";
  const db = getDb();
  const ids = [randomUUID(), randomUUID()];
  const email = `qa-${ids[0]}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const originalFetch = globalThis.fetch;
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
    throw new Error(
      "Stop the generation worker before integration tests; tests never send paid generation requests.",
    );
  }
  const anonymous = await request.newContext({ baseURL });
  const client = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
  });
  try {
    assert.equal((await anonymous.get("/api/projects")).status(), 401);
    console.log("PASS anonymous API access rejected");
    for (const [index, id] of ids.entries()) {
      await db.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
        [id, "QA Creator", index === 0 ? email : `qa-${id}@example.invalid`],
      );
      await db.query(
        'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
        [randomUUID(), id, "credential", await hashPassword(password)],
      );
    }
    const login = await client.post("/api/auth/sign-in/email", {
      data: { email, password },
    });
    assert.equal(login.status(), 200);
    console.log("PASS PostgreSQL email/password login");
    const registered = await request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL },
    });
    try {
      const registration = await registered.post("/api/auth/sign-up/email", {
        data: {
          email: `qa-register-${randomUUID()}@example.invalid`,
          password,
          name: "QA new user",
        },
      });
      assert.equal(registration.status(), 200);
      const result = await registration.json();
      ids.push(result.user.id);
      assert.equal((await registered.get("/api/projects")).status(), 200);
      assert.equal(
        (await registered.post("/api/projects", { data: {} })).status(),
        200,
      );
      console.log(
        "PASS self-registration creates a session without email verification or SMTP",
      );
    } finally {
      await registered.dispose();
    }
    const create = await client.post("/api/projects", { data: {} });
    assert.equal(create.status(), 200);
    const project = await create.json();
    const foreignId = randomUUID();
    await db.query(
      "INSERT INTO ac_projects(id,owner_id,name) VALUES($1,$2,$3)",
      [foreignId, ids[1], "Other user project"],
    );
    assert.equal(
      (await client.get(`/api/projects/${foreignId}`)).status(),
      404,
    );
    console.log("PASS cross-user project isolation");
    assert.equal(
      (
        await client.patch(`/api/projects/${project.id}`, {
          headers: { Origin: "https://untrusted.invalid" },
          data: { name: "blocked" },
        })
      ).status(),
      403,
    );
    console.log("PASS untrusted write origin rejected");
    const image = await sharp({
      create: { width: 800, height: 450, channels: 3, background: "#7797ad" },
    })
      .png()
      .toBuffer();
    const upload = await client.post("/api/uploads", {
      multipart: {
        projectId: project.id,
        file: { name: "qa.png", mimeType: "image/png", buffer: image },
      },
    });
    assert.equal(upload.status(), 200);
    const asset = await upload.json();
    const readable = await client.get(`/api/assets/${asset.id}/content`);
    assert.equal(readable.status(), 200);
    assert.equal(readable.headers()["content-type"].split(";")[0], "image/png");
    console.log("PASS real S3 upload, signed URL and image read");
    const key = randomUUID();
    const input = {
      prompt: "QA integration image",
      referenceAssetId: asset.id,
      config: defaultConfig,
    };
    const generation = await client.post(
      `/api/projects/${project.id}/generations`,
      { headers: { "Idempotency-Key": key }, data: input },
    );
    assert.equal(generation.status(), 202);
    const task = await generation.json();
    const duplicate = await client.post(
      `/api/projects/${project.id}/generations`,
      { headers: { "Idempotency-Key": key }, data: input },
    );
    assert.equal((await duplicate.json()).id, task.id);
    assert.equal(
      (
        await client.post(`/api/projects/${project.id}/generations`, {
          headers: { "Idempotency-Key": randomUUID() },
          data: input,
        })
      ).status(),
      409,
    );
    console.log(
      "PASS durable task creation, idempotency and concurrency guard",
    );
    let submitted: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/images/generations")) {
        if (init?.method === "POST") {
          submitted = JSON.parse(String(init.body));
          return Response.json({ id: "qa-task", status: "queued" });
        }
        return Response.json({
          status: "completed",
          progress: 100,
          result: { data: [{ url: "https://toapis.com/qa-result.png" }] },
        });
      }
      if (url === "https://toapis.com/qa-result.png")
        return new Response(image, {
          headers: { "Content-Type": "image/png" },
        });
      return originalFetch(input, init);
    }) as typeof fetch;
    await tick(ids[0]);
    assert.equal(
      (submitted as unknown as { model: string }).model,
      "gpt-image-2",
    );
    await db.query("UPDATE ac_tasks SET next_poll=now() WHERE id=$1", [
      task.id,
    ]);
    await tick(ids[0]);
    globalThis.fetch = originalFetch;
    const complete = await (
      await client.get(`/api/projects/${project.id}`)
    ).json();
    assert.equal(complete.tasks[0].status, "completed");
    assert.equal(complete.nodes.length, 1);
    assert.ok(complete.nodes[0].asset_id);
    console.log(
      "PASS worker state machine and real S3 result transfer (mocked generation, no paid request)",
    );
    const saved = await client.put(`/api/projects/${project.id}/canvas`, {
      data: {
        version: complete.project.version,
        viewport: { x: 30, y: 40, zoom: 0.75 },
        nodes: [{ id: complete.nodes[0].id, x: 180, y: 140 }],
      },
    });
    assert.equal(saved.status(), 200);
    assert.equal(
      (
        await client.put(`/api/projects/${project.id}/canvas`, {
          data: {
            version: complete.project.version,
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [],
          },
        })
      ).status(),
      409,
    );
    console.log("PASS canvas persistence and stale-version rejection");
    assert.equal(
      providerPayload(
        { ...input, config: { ...defaultConfig, model: NANO_MODEL } },
        "https://example.com/ref.png",
      ).n,
      1,
    );
    assert.equal(
      (
        providerPayload(
          { ...input, config: { ...defaultConfig, model: NANO_MODEL } },
          "https://example.com/ref.png",
        ) as { metadata: { resolution: string } }
      ).metadata.resolution,
      "1K",
    );
    await mkdir("test-results", { recursive: true });
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const context = await browser.newContext({
      storageState: await client.storageState(),
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${baseURL}/protected`);
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
    await expect(page.locator(".project-grid .skeleton")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/protected.png",
      fullPage: true,
    });
    await page.goto(`${baseURL}/projects`);
    await expect(
      page.getByRole("heading", { name: "项目", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/projects.png",
      fullPage: true,
    });
    await page.goto(`${baseURL}/canvas?projectId=${project.id}`);
    await page.getByRole("button", { name: "选择创作模式" }).click();
    await page
      .getByRole("menuitemradio", { name: "生图", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "配置图片参数" }),
    ).toBeVisible();
    await expect(page.locator(".image-node img")).toBeVisible();
    await expect
      .poll(
        () =>
          page
            .locator(".image-node img")
            .evaluate((image) => (image as HTMLImageElement).naturalWidth),
        { timeout: 45000 },
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "配置图片参数" }).click();
    await expect(
      page.getByRole("dialog", { name: "GPT Image2 图片配置" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/canvas-config.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "选择生图模型" }).click();
    await page.getByRole("button", { name: /Nano Banana 2.1/ }).click();
    await page.getByRole("button", { name: "配置图片参数" }).click();
    await expect(
      page.getByRole("dialog", { name: "Nano Banana 图片配置" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "4K", exact: true }).click();
    await page.getByRole("button", { name: "16:9", exact: true }).click();
    await page.screenshot({ path: "test-results/canvas-nano-config.png" });
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const state = await (
          await client.get(`/api/projects/${project.id}`)
        ).json();
        return state.project.config.resolution;
      })
      .toBe("4k");
    await page.getByRole("button", { name: "将结果设为参考图" }).click();
    await expect(page.locator(".reference-thumb img")).toBeVisible();
    await page.screenshot({ path: "test-results/canvas-reference.png" });
    const separator = page.getByRole("separator");
    const rect = await separator.boundingBox();
    if (rect) {
      await page.mouse.move(rect.x + 2, rect.y + 200);
      await page.mouse.down();
      await page.mouse.move(400, rect.y + 200);
      await page.mouse.up();
      assert.equal(await separator.getAttribute("aria-valuenow"), "620");
    }
    await page.reload();
    await expect(page.locator(".image-node")).toBeVisible();
    await page.screenshot({ path: "test-results/canvas.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("button", { name: "选择创作模式" }).click();
    await page
      .getByRole("menuitemradio", { name: "生图", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "配置图片参数" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/canvas-mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser home/projects/canvas, model config, panel clamp, refresh and mobile layout",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseURL}/protected`);
    await page
      .getByRole("textbox", { name: "生图提示词" })
      .fill("UI submission integration check");
    await page.getByRole("button", { name: "发送并生成图片" }).click();
    await expect(page).toHaveURL(/\/canvas\?projectId=/);
    await expect(page.locator(".generation-placeholder")).toBeVisible();
    console.log(
      "PASS homepage send creates project and restores durable loading placeholder",
    );
    const unknownProject = await (
      await client.post("/api/projects", { data: {} })
    ).json();
    const unknown = await (
      await client.post(`/api/projects/${unknownProject.id}/generations`, {
        headers: { "Idempotency-Key": randomUUID() },
        data: { prompt: "Unknown receipt simulation", config: defaultConfig },
      })
    ).json();
    // Make only this fixture eligible; the homepage submission remains untouched.
    await db.query(
      "UPDATE ac_tasks SET next_poll=now()+interval '1 hour' WHERE owner_id=$1 AND id<>$2 AND status='submitting'",
      [ids[0], unknown.id],
    );
    let submissions = 0;
    globalThis.fetch = (async (input, init) => {
      if (
        String(input).includes("/v1/images/generations") &&
        init?.method === "POST"
      ) {
        submissions++;
        throw new TypeError("Simulated interrupted submission");
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    await tick(ids[0]);
    await tick(ids[0]);
    globalThis.fetch = originalFetch;
    assert.equal(submissions, 1);
    const uncertain = await (
      await client.get(`/api/generations/${unknown.id}`)
    ).json();
    assert.equal(uncertain.status, "submission_unknown");
    console.log(
      "PASS uncertain provider receipt never automatically resubmits a paid request",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await browser?.close();
    await client.dispose();
    await anonymous.dispose();
    const assets = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=ANY($1::uuid[])",
      [ids],
    );
    for (const asset of assets.rows)
      await deleteObject(asset.object_key).catch(() => {});
    await db.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
    await db.query("DELETE FROM ac_worker_health WHERE id=$1", [
      `test:${ids[0]}`,
    ]);
    await lock.query("SELECT pg_advisory_unlock(hashtext('ai-canvas-worker'))");
    lock.release();
    await db.end();
  }
}
main().catch((e) => {
  console.error(
    "INTEGRATION FAILED",
    e instanceof Error ? e.message : "Unknown error",
  );
  process.exitCode = 1;
});
