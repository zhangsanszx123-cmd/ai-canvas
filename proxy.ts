import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
  if (!getSessionCookie(request))
    return NextResponse.redirect(new URL("/auth/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/skills/:path*"],
};
