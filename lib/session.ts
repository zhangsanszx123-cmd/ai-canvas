import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { HttpError } from "./http";
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "请先登录");
  return session.user;
}
export async function pageUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/login");
  return session.user;
}
