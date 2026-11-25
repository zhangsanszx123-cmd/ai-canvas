import { Suspense } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppHeader } from "@/components/canvas/app-header";
import { CreativeHome } from "@/components/canvas/home";
import { RouteLoading } from "@/components/canvas/route-loading";
async function HomeContent() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="app-shell">
      <AppHeader name={session?.user.name} />
      <CreativeHome authenticated={Boolean(session)} />
    </div>
  );
}
export default function Home() {
  return (
    <Suspense fallback={<RouteLoading label="正在打开首页…" />}>
      <HomeContent />
    </Suspense>
  );
}
