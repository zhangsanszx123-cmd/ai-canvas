import { strict as assert } from "node:assert";
import { test } from "node:test";
import { providerFailureMessage } from "../lib/provider-errors";
import { submit } from "../lib/provider";
import { defaultConfig } from "../lib/models";
import { getDb } from "../lib/db";
import { tick } from "../lib/worker";

test("maps provider failure reasons without exposing raw details", () => {
  const cases: [unknown, string][] = [
    [
      {
        code: "generation_failed",
        message: "请求未通过内容安全审核. 请调整提示词或更换参考图后重试.",
      },
      "内容安全审核",
    ],
    [{ code: "content_policy_violation" }, "内容安全审核"],
    [{ code: "insufficient_quota" }, "余额或额度不足"],
    [{ message: "账户余额不足" }, "余额或额度不足"],
    [{ code: "invalid_api_key" }, "认证失败"],
    [{ code: "permission_denied" }, "无访问权限"],
    [{ code: "rate_limit_exceeded" }, "请求过于频繁"],
    [{ code: "invalid_parameter" }, "参数不受支持"],
    [null, "未提供可识别的原因"],
    [{ code: 123, message: { secret: "private" } }, "未提供可识别的原因"],
    [
      {
        message:
          "Internal error sk-private https://private.invalid/?token=secret",
      },
      "未提供可识别的原因",
    ],
  ];
  for (const [error, expected] of cases) {
    const result = providerFailureMessage(error);
    assert.ok(result.includes(expected), result);
    assert.doesNotMatch(result, /sk-private|https:|token=|secret/);
  }
});

test("submission failures use safe messages and retain uncertain acceptance", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOAPIS_API_KEY;
  process.env.TOAPIS_API_KEY = "test-only-key";
  let calls = 0;
  try {
    for (const [status, body, expected] of [
      [
        400,
        JSON.stringify({
          error: {
            code: "generation_failed",
            message: "请求未通过内容安全审核",
          },
        }),
        "内容安全审核",
      ],
      [402, "not json", "余额或额度不足"],
      [401, "{}", "认证失败"],
      [403, "{}", "无访问权限"],
      [429, "{}", "请求过于频繁"],
      [422, "{}", "参数不受支持"],
      [
        500,
        JSON.stringify({ error: { code: "insufficient_quota" } }),
        "受理状态未知",
      ],
    ] as const) {
      globalThis.fetch = async () => {
        calls++;
        return new Response(body, { status });
      };
      await assert.rejects(
        submit({ prompt: "test", config: defaultConfig }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(expected));
          assert.equal(
            (error as Error & { uncertain: boolean }).uncertain,
            status >= 500,
          );
          return true;
        },
      );
    }
    assert.equal(
      calls,
      7,
      "each submission sends once without automatic retry",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOAPIS_API_KEY;
    else process.env.TOAPIS_API_KEY = originalKey;
  }
});

test("worker persists the classified asynchronous failure without resubmitting", async () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalKey = process.env.TOAPIS_API_KEY;
  const originalFetch = globalThis.fetch;
  // No database or external service is contacted by this regression test.
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost/test";
  process.env.TOAPIS_API_KEY = "test-only-key";
  const db = getDb();
  const originalQuery = db.query;
  const originalConnect = db.connect;
  const writes: { sql: string; values: unknown[] }[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    writes.push({ sql, values });
    return {
      rows: sql.startsWith("SELECT * FROM ac_tasks")
        ? [
            {
              id: "test-task",
              provider_id: "existing-provider-task",
              status: "in_progress",
              results: [],
            },
          ]
        : [],
      rowCount: 1,
    };
  };
  Object.defineProperty(db, "query", {
    configurable: true,
    writable: true,
    value: query,
  });
  Object.defineProperty(db, "connect", {
    configurable: true,
    writable: true,
    value: async () => ({ query, release() {} }),
  });
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests++;
    assert.notEqual(init?.method, "POST");
    return Response.json({
      status: "failed",
      error: {
        code: "generation_failed",
        message: "请求未通过内容安全审核. 请调整提示词或更换参考图后重试.",
      },
    });
  };
  try {
    assert.equal(await tick(), true);
    const failure = writes.find((write) =>
      write.sql.includes("SET status='failed',error=$2"),
    );
    assert.ok(failure);
    assert.equal(failure.values[0], "test-task");
    assert.equal(
      failure.values[1],
      "请求未通过内容安全审核，请调整提示词或更换参考图后重试",
    );
    assert.equal(requests, 1);
  } finally {
    db.query = originalQuery;
    db.connect = originalConnect;
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.TOAPIS_API_KEY;
    else process.env.TOAPIS_API_KEY = originalKey;
    await db.end();
  }
});
