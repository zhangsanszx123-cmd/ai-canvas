import { Suspense } from "react";
import { pageUser } from "@/lib/session";
import { AppHeader } from "@/components/canvas/app-header";
import { SkillLibrary } from "@/components/canvas/skill-library";
import { RouteLoading } from "@/components/canvas/route-loading";
async function Content() {
  const user = await pageUser();
  return (
    <main className="app-shell">
      <AppHeader name={user.name} />
      <SkillLibrary />
    </main>
  );
}
export default function SkillsPage() {
  return (
    <Suspense fallback={<RouteLoading label="正在打开技能库…" />}>
      <Content />
    </Suspense>
  );
}
