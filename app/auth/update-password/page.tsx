import { AuthForm } from "@/components/canvas/auth-form";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
export default function ResetPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AuthForm mode="reset" mailConfigured />
    </Suspense>
  );
}
