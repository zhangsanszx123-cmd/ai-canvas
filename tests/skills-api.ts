import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { request } from "@playwright/test";
import { getDb } from "../lib/db";
import { deleteObject } from "../lib/storage";
async function main() {
  const db = getDb(),
    owner = randomUUID(),
    stranger = randomUUID(),
    password = randomBytes(24).toString("base64url"),
    email = `skill-${randomUUID()}@example.invalid`;
  const client = await request.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
    timeout: 120000,
  });
  const foreign = await request.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  try {
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [owner, "Skill QA", email],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), owner, "credential", await hashPassword(password)],
    );
    assert.equal(
      (
        await client.post("/api/auth/sign-in/email", {
          data: { email, password },
        })
      ).status(),
      200,
    );
    const project = await (
      await client.post("/api/projects", { data: {} })
    ).json();
    const other = await (
      await client.post("/api/projects", { data: {} })
    ).json();
    const source = await readFile("docs/skills/wechat-cover/SKILL.md");
    const uploaded = await client.post(`/api/projects/${project.id}/skills`, {
      multipart: {
        file: { name: "SKILL.md", mimeType: "text/markdown", buffer: source },
      },
    });
    assert.equal(uploaded.status(), 200);
    const skill = await uploaded.json();
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
      [stranger, "Skill Stranger", `skill-${stranger}@example.invalid`],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2::text,$3,$2::uuid,$4,now(),now())',
      [randomUUID(), stranger, "credential", await hashPassword(password)],
    );
    assert.equal(
      (
        await foreign.post("/api/auth/sign-in/email", {
          data: { email: `skill-${stranger}@example.invalid`, password },
        })
      ).status(),
      200,
    );
    assert.equal(
      (await foreign.get(`/api/projects/${project.id}/skills`)).status(),
      404,
    );
    assert.equal(
      (
        await foreign.get(`/api/projects/${project.id}/skills/${skill.id}`)
      ).status(),
      404,
    );
    assert.equal(
      (
        await foreign.delete(`/api/projects/${project.id}/skills/${skill.id}`)
      ).status(),
      404,
    );
    assert.equal(
      (
        await client.post(`/api/projects/${other.id}/agent`, {
          data: { prompt: "应用技能", skillId: skill.id },
        })
      ).status(),
      200,
    );
    assert.equal(
      (await (await client.get(`/api/projects/${other.id}/agent`)).json())
        .messages.length,
      0,
    );
    assert.equal(skill.name, "wechat-cover");
    const stored = await (
      await client.get(`/api/projects/${project.id}/skills/${skill.id}`)
    ).json();
    assert.equal(stored.source, source.toString());
    assert(stored.body.includes("孟菲斯"));
    assert.equal(
      (
        await client.get(`/api/projects/${other.id}/skills/${skill.id}`)
      ).status(),
      404,
    );
    assert.equal(
      (
        await client.delete(`/api/projects/${other.id}/skills/${skill.id}`)
      ).status(),
      404,
    );
    const invalid = await client.post(`/api/projects/${project.id}/skills`, {
      multipart: {
        file: {
          name: "SKILL.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(
            "---\nname: ../escape\ndescription: test\n---\n规则",
          ),
        },
      },
    });
    assert.equal(invalid.status(), 422);
    const article =
      "# 给专注留边界\n\n远程办公原本应减少通勤，但过多会议不断打断深度工作。团队成员开始用开会代替明确写作。\n\n## 解决方法\n默认异步沟通，写清背景、负责人和截止时间，只对真正需要实时决策的问题开会。\n\n## 结尾\n最重要的不是取消全部会议，而是明确同步与异步沟通的边界，给专注留出空间。";
    const doc = await (
      await client.post("/api/uploads", {
        multipart: {
          projectId: project.id,
          file: {
            name: "article.md",
            mimeType: "text/markdown",
            buffer: Buffer.from(article),
          },
        },
      })
    ).json();
    const first = await client.post(`/api/projects/${project.id}/agent`, {
      data: {
        prompt: "请为这篇文章做公众号封面",
        attachmentIds: [doc.id],
        skillId: skill.id,
      },
    });
    assert.equal(first.status(), 200);
    const events = (await first.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert(!events.some((e) => e.type === "error"));
    const text = events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.delta)
      .join("");
    for (const name of ["极简大字报", "杂志封面", "插画", "科技", "孟菲斯"])
      assert(text.includes(name), `Missing style ${name}`);
    assert.equal(
      (await (await client.get(`/api/projects/${project.id}`)).json()).tasks
        .length,
      0,
    );
    const history = await (
      await client.get(`/api/projects/${project.id}/agent`)
    ).json();
    assert.deepEqual(history.messages[0].skillNames, ["wechat-cover"]);
    console.log(
      "PASS real Skill upload/full rules, project isolation, traversal rejection, saved name and actual DeepSeek style gate with zero image tasks",
    );
    if (process.argv.includes("--generate")) {
      const selected = await client.post(`/api/projects/${project.id}/agent`, {
        data: { prompt: "选择 1，极简大字报，请按技能一次生成四张。" },
      });
      const lines = (await selected.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert(!lines.some((e) => e.type === "error"));
      const state = await (
        await client.get(`/api/projects/${project.id}`)
      ).json();
      assert.equal(state.tasks.length, 4);
      for (const task of state.tasks) {
        assert.equal(task.config.model, "gpt-image-2.5-sunburst");
        assert.equal(task.config.size, "21:9");
      }
      const batches = await db.query(
        "SELECT DISTINCT batch_id FROM ac_tasks WHERE project_id=$1",
        [project.id],
      );
      assert.equal(batches.rows.length, 1);
      assert(batches.rows[0].batch_id);
      const deadline = Date.now() + 600000;
      let done = false;
      while (Date.now() < deadline) {
        const snapshot = await (
          await client.get(`/api/projects/${project.id}`)
        ).json();
        if (
          snapshot.tasks.some((t: { status: string }) =>
            ["failed", "submission_unknown"].includes(t.status),
          )
        )
          throw new Error("Cover batch failed; inspect task state");
        if (
          snapshot.tasks.every(
            (t: { status: string }) => t.status === "completed",
          )
        ) {
          assert.equal(
            snapshot.nodes.filter((n: { asset_id: string }) => n.asset_id)
              .length,
            4,
          );
          done = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      assert(done, "Cover batch did not finish within observation window");
      console.log(
        "PASS real four-image GPT Image 2.5 wide cover batch completed and persisted to canvas",
      );
    }
    assert.equal(
      (
        await client.delete(`/api/projects/${project.id}/skills/${skill.id}`)
      ).status(),
      200,
    );
    assert.equal(
      (
        await client.get(`/api/projects/${project.id}/skills/${skill.id}`)
      ).status(),
      404,
    );
    assert.deepEqual(
      (await (await client.get(`/api/projects/${project.id}/agent`)).json())
        .messages[0].skillNames,
      ["wechat-cover"],
    );
  } finally {
    const files = await db.query(
      "SELECT object_key FROM ac_assets WHERE owner_id=$1",
      [owner],
    );
    for (const file of files.rows) await deleteObject(file.object_key);
    await db.query('DELETE FROM "user" WHERE id=$1', [owner]);
    await db.query('DELETE FROM "user" WHERE id=$1', [stranger]);
    await foreign.dispose();
    await client.dispose();
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error.name, error.message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exitCode = 1;
});
