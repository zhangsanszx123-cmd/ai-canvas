import Link from "next/link";
export default function NotFound() {
  return (
    <main className="workspace-error">
      <h1>页面或项目不存在</h1>
      <p>项目可能已删除，或你没有访问权限。</p>
      <Link href="/projects" className="primary-button">
        返回项目列表
      </Link>
    </main>
  );
}
