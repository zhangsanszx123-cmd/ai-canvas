import { AuthForm } from "@/components/canvas/auth-form";
import { mailReady } from "@/lib/mail";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
export default function SignUpPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AuthForm mode="signup" mailConfigured={mailReady()} />
    </Suspense>
  );
}
