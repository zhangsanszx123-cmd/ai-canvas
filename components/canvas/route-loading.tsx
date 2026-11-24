export function RouteLoading({ label = "正在打开…" }: { label?: string }) {
  return (
    <div className="page-loading" role="status">
      {label}
    </div>
  );
}
