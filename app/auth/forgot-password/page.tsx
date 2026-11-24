import { AuthForm } from "@/components/canvas/auth-form";
import { mailReady } from "@/lib/mail";
import { connection } from "next/server";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
async function ForgotContent() {
  await connection();
  return <AuthForm mode="forgot" mailConfigured={mailReady()} />;
}
export default function ForgotPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <ForgotContent />
    </Suspense>
  );
}
