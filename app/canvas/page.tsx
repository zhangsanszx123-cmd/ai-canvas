import { redirect, notFound } from "next/navigation";
import { pageUser } from "@/lib/session";
import { projectFor } from "@/lib/repository";
import { Workspace } from "@/components/canvas/workspace";
import { HttpError, uuid } from "@/lib/http";
import { Suspense } from "react";
import { RouteLoading } from "@/components/canvas/route-loading";
type CanvasPageProps = { searchParams: Promise<{ projectId?: string }> };
async function CanvasContent({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const user = await pageUser();
  const { projectId } = await searchParams;
  if (!projectId) redirect("/projects");
  try {
    await projectFor(user.id, uuid(projectId));
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return <Workspace projectId={projectId} />;
}
export default function CanvasPage({ searchParams }: CanvasPageProps) {
  return (
    <Suspense fallback={<RouteLoading label="正在打开画布…" />}>
      <CanvasContent searchParams={searchParams} />
    </Suspense>
  );
}
