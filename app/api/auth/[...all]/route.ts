import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { mailReady } from "@/lib/mail";
import { NextResponse } from "next/server";
const handler = toNextJsHandler(auth);
export const GET = handler.GET;
export async function POST(request: Request) {
  if (
    /\/request-password-reset/.test(new URL(request.url).pathname) &&
    !mailReady()
  )
    return NextResponse.json(
      {
        message: "密码重置邮件服务尚未配置，请联系管理员完成配置",
        code: "MAIL_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  return handler.POST(request);
}
