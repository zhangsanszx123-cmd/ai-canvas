import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
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
    await page.goto("http://localhost:3000/projects");

    const headers = { Origin: "http://localhost:3000" };
    await page.request.patch("http://localhost:3000/api/projects/" + id, {
      headers,
      data: { name: "待删除测试项目" },
    });
    const image = await sharp({
      create: { width: 40, height: 60, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const asset = await (
      await page.request.post("http://localhost:3000/api/uploads", {
        headers,
        multipart: {
          projectId: id,
          file: { name: "qa.png", mimeType: "image/png", buffer: image },
        },
      })
    ).json();
    await page.reload();
    const link = page.locator(
      'a.project-card[href="/canvas?projectId=' + id + '"]',
    );
    await expect(link).toBeVisible();
    await link.hover();
    await page
      .getByRole("button", { name: "项目操作 待删除测试项目", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "删除项目 待删除测试项目", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "删除项目？" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(link).toBeVisible();
    await db.query(
      "UPDATE ac_projects SET agent_lease_until=now()+interval '1 minute' WHERE id=$1",
      [id],
    );
    assert.equal(
      (
        await page.request.delete("http://localhost:3000/api/projects/" + id, {
          headers,
        })
      ).status(),
      409,
    );
    await db.query(
      "UPDATE ac_projects SET agent_lease_until=NULL WHERE id=$1",
      [id],
    );
    const task = randomUUID();
    await db.query(
      "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,config,idempotency_key,request_hash,status) VALUES($1,$2,$3,'Deletion fixture',$4,$5,'fixture','submission_unknown')",
      [
        task,
        id,
        owner,
        { model: "gpt-image-2", size: "1:1", resolution: "1k", n: 1 },
        randomUUID(),
      ],
    );
    assert.equal(
      (
        await page.request.delete("http://localhost:3000/api/projects/" + id, {
          headers,
        })
      ).status(),
      409,
    );
    await db.query("UPDATE ac_tasks SET status='failed' WHERE id=$1", [task]);
    const foreignId = randomUUID();
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [
        foreignId,
        "Foreign deletion QA",
        "delete-" + foreignId + "@example.invalid",
      ],
    );
    try {
      const foreignProject = randomUUID();
      await db.query(
        "INSERT INTO ac_projects(id,owner_id,name) VALUES($1,$2,'Other project')",
        [foreignProject, foreignId],
      );
      assert.equal(
        (
          await page.request.delete(
            "http://localhost:3000/api/projects/" + foreignProject,
            { headers },
          )
        ).status(),
        404,
      );
      assert.equal(
        (
          await db.query("SELECT deleted_at FROM ac_projects WHERE id=$1", [
            foreignProject,
          ])
        ).rows[0].deleted_at,
        null,
      );
    } finally {
      await db.query('DELETE FROM "user" WHERE id=$1', [foreignId]);
    }
    await link.hover();
    await page
      .getByRole("button", { name: "项目操作 待删除测试项目", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "删除项目 待删除测试项目", exact: true })
      .click();
    const removed = page.waitForResponse(
      (response) =>
        response.url() === "http://localhost:3000/api/projects/" + id &&
        response.request().method() === "DELETE",
    );
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    assert.equal((await removed).status(), 200);
    assert(
      (await db.query("SELECT deleted_at FROM ac_projects WHERE id=$1", [id]))
        .rows[0].deleted_at,
    );
    await expect(link).toHaveCount(0);
    const deletedProjectResponse = await page.request.get(
      "http://localhost:3000/api/projects/" + id,
    );
    assert.equal(
      deletedProjectResponse.status(),
      404,
      "Deleted project must be inaccessible",
    );
    assert.equal(
      (
        await page.request.get(
          "http://localhost:3000/api/assets/" + asset.id + "/url",
        )
      ).status(),
      404,
      "Deleted project's asset must be inaccessible",
    );
    assert.equal(
      (
        await page.request.get("http://localhost:3000/api/generations/" + task)
      ).status(),
      404,
      "Deleted project's task must be inaccessible",
    );
    assert.equal(
      (await db.query("SELECT id FROM ac_assets WHERE id=$1", [asset.id]))
        .rowCount,
      1,
    );
    await page.reload();
    await expect(link).toHaveCount(0);
    await page.goto("http://localhost:3000/protected");
    await expect(
      page.locator('a[href="/canvas?projectId=' + id + '"]'),
    ).toHaveCount(0);
    assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
    console.log(
      "PASS Chrome delete confirmation/cancel, project and home lists, reload persistence, owner isolation, active task/Agent protection, inaccessible deleted resources and retained originals",
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
