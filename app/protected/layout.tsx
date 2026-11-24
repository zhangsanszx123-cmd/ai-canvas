import { pageUser } from "@/lib/session";
import { AppHeader } from "@/components/canvas/app-header";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await pageUser();
  return (
    <div className="app-shell">
      <AppHeader name={user.name} />
      {children}
    </div>
  );
}
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<RouteLoading label="正在打开创作首页…" />}>
      <AuthenticatedLayout>{children}</AuthenticatedLayout>
    </Suspense>
  );
}
