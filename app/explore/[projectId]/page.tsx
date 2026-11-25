import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RouteLoading } from "@/components/canvas/route-loading";
async function Content({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return redirect("/canvas?projectId=" + encodeURIComponent(projectId));
}
export default function PublicProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoading label="正在打开项目…" />}>
      <Content params={params} />
    </Suspense>
  );
}
