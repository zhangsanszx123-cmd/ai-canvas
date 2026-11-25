import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppHeader } from "@/components/canvas/app-header";
import { ProjectGrid } from "@/components/canvas/project-grid";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
async function ProjectsContent() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <main className="app-shell">
      <AppHeader name={session?.user.name} />
      <div className="all-projects">
        <ProjectGrid publicView={!session} />
      </div>
    </main>
  );
}
export default function ProjectsPage() {
  return (
    <Suspense fallback={<RouteLoading label="正在打开项目列表…" />}>
      <ProjectsContent />
    </Suspense>
  );
}
