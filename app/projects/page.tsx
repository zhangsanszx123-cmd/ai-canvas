import { pageUser } from "@/lib/session";
import { AppHeader } from "@/components/canvas/app-header";
import { ProjectGrid } from "@/components/canvas/project-grid";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
async function ProjectsContent() {
  const user = await pageUser();
  return (
    <main className="app-shell">
      <AppHeader name={user.name} />
      <div className="all-projects">
        <ProjectGrid />
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
