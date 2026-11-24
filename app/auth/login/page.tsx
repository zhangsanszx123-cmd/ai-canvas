import { AuthForm } from "@/components/canvas/auth-form";
import { mailReady } from "@/lib/mail";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
export default function LoginPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AuthForm mode="login" mailConfigured={mailReady()} />
    </Suspense>
  );
}
