import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { projectFor } from "@/lib/repository";
import { Workspace } from "@/components/canvas/workspace";
import { HttpError, uuid } from "@/lib/http";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
import { publicProject } from "@/lib/public-projects";
import { PublicWorkspace } from "@/components/canvas/public-workspace";
type CanvasPageProps = { searchParams: Promise<{ projectId?: string }> };
async function CanvasContent({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const { projectId } = await searchParams;
  if (!projectId) redirect("/projects");
  try {
    uuid(projectId);
    if (session) {
      try {
        await projectFor(session.user.id, projectId);
        return <Workspace projectId={projectId} />;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    }
    return (
      <PublicWorkspace
        data={await publicProject(projectId)}
        authenticated={Boolean(session)}
      />
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
}
export default function CanvasPage({ searchParams }: CanvasPageProps) {
  return (
    <Suspense fallback={<RouteLoading label="正在打开画布…" />}>
      <CanvasContent searchParams={searchParams} />
    </Suspense>
  );
}
