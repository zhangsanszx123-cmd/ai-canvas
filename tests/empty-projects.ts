import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db";

async function main() {
  const db = getDb();
  const owner = randomUUID(),
    foreign = randomUUID();
  const email = `empty-${owner}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  const client = context.request;
  const expected = new Set<string>();
  async function project(name: string, user = owner) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO ac_projects(id,owner_id,name) VALUES($1,$2,$3)",
      [id, user, name],
    );
    return id;
  }
  async function list(query = "") {
    const response = await client.get(`/api/projects${query}`);
    assert.equal(response.status(), 200);
    return response.json() as Promise<{
      items: { id: string }[];
      nextCursor: string | null;
    }>;
  }
  try {
    for (const id of [owner, foreign])
      await db.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
        [
          id,
          "Empty project QA",
          id === owner ? email : `${id}@example.invalid`,
        ],
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

    const draftResponse = await client.post("/api/projects", { data: {} });
    assert.equal(draftResponse.status(), 200);
    const { id: draft } = await draftResponse.json();
    assert.equal((await client.get(`/api/projects/${draft}`)).status(), 200);
    assert.deepEqual((await list()).items, []);
    await client.patch(`/api/projects/${draft}`, {
      data: { name: "Only renamed" },
    });
    assert.deepEqual((await list()).items, []);

    const conversation = await project("Conversation");
    await db.query("UPDATE ac_projects SET agent_messages=$2 WHERE id=$1", [
      conversation,
      JSON.stringify([{ prompt: "Existing conversation", events: [] }]),
    ]);
    expected.add(conversation);
    const task = await project("Failed task");
    await db.query(
      "INSERT INTO ac_tasks(id,project_id,owner_id,prompt,config,idempotency_key,request_hash,status) VALUES($1,$2,$3,'QA', '{}', $4,'fixture','failed')",
      [randomUUID(), task, owner, randomUUID()],
    );
    expected.add(task);
    const asset = await project("Attachment");
    const assetId = randomUUID();
    await db.query(
      "INSERT INTO ac_assets(id,project_id,owner_id,object_key,mime,width,height,bytes) VALUES($1,$2,$3,$4,'image/png',1,1,1)",
      [assetId, asset, owner, `empty-project-qa/${assetId}`],
    );
    expected.add(asset);
    const node = await project("Canvas node");
    await db.query("INSERT INTO ac_nodes(id,project_id) VALUES($1,$2)", [
      randomUUID(),
      node,
    ]);
    expected.add(node);
    const skill = await project("Uploaded skill");
    await db.query(
      "INSERT INTO ac_skills(id,project_id,owner_id,name,description,source,body) VALUES($1,$2,$3,'qa-skill','QA','QA','QA')",
      [randomUUID(), skill, owner],
    );
    expected.add(skill);
    const running = await project("Active agent");
    await db.query(
      "UPDATE ac_projects SET agent_lease_until=now()+interval '1 minute' WHERE id=$1",
      [running],
    );
    expected.add(running);
    const other = await project("Foreign conversation", foreign);
    const deleted = await project("Deleted conversation");
    await db.query(
      'UPDATE ac_projects SET agent_messages=\'[{"prompt":"QA"}]\',deleted_at=CASE WHEN id=$1 THEN now() END WHERE id=ANY($2::uuid[])',
      [deleted, [deleted, other]],
    );
    for (let i = 0; i < 23; i++) await project("Empty draft");

    const actual = new Set<string>();
    let cursor: string | null = null;
    do {
      const data = await list(
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      assert(data.items.length > 0);
      for (const item of data.items) {
        assert(!actual.has(item.id));
        actual.add(item.id);
      }
      cursor = data.nextCursor;
    } while (cursor);
    assert.deepEqual(actual, expected);

    const page = await context.newPage();
    await page.goto("/projects");
    await expect(page.locator("a.project-card")).toHaveCount(expected.size);
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await expect(page).toHaveURL(/canvas\?projectId=/);
    const blankId = new URL(page.url()).searchParams.get("projectId")!;
    await page.goto("/");
    await expect(page.locator("a.project-card")).toHaveCount(4);
    await expect(
      page.locator(`a[href="/canvas?projectId=${blankId}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`a[href="/canvas?projectId=${draft}"]`),
    ).toHaveCount(0);

    await db.query(
      'UPDATE ac_projects SET agent_messages=\'[{"prompt":"Saved content"}]\' WHERE id=$1',
      [draft],
    );
    assert((await list()).items.some((item) => item.id === draft));
    await db.query("UPDATE ac_projects SET agent_messages='[]' WHERE id=$1", [
      draft,
    ]);
    assert(!(await list()).items.some((item) => item.id === draft));
    console.log(
      "PASS empty drafts hidden on home/projects, new blank canvas, content preservation, promotion, pagination, deleted/foreign isolation; no generation requests.",
    );
  } finally {
    await browser.close();
    await db.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
      [owner, foreign],
    ]);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error.name, error.message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exitCode = 1;
});
