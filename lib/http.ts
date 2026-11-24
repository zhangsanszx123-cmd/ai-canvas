import { NextResponse } from "next/server";
import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_ERROR",
  ) {
    super(message);
  }
}
export async function respond(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const id = crypto.randomUUID();
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof ZodError || e instanceof SyntaxError
          ? 422
          : 500;
    const message =
      e instanceof HttpError
        ? e.message
        : e instanceof ZodError
          ? e.issues[0].message
          : status === 422
            ? "请求格式不正确"
            : "服务暂时不可用，请稍后重试";
    if (status === 500)
      console.error(
        "request_failed",
        id,
        e instanceof Error ? e.name : "UnknownError",
      );
    return NextResponse.json(
      {
        error: {
          code: e instanceof HttpError ? e.code : String(status),
          message,
        },
        requestId: id,
      },
      { status },
    );
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || "http://localhost:3000")
    .origin;
  if (!origin || origin !== expected)
    throw new HttpError(403, "请求来源不受信任");
}
export function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(404, "项目或资源不存在");
  return value;
}
