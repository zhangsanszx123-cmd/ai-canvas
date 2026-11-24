"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="workspace-error">
      <h1>暂时无法打开页面</h1>
      <p>请检查服务配置或稍后重试。</p>
      <button className="primary-button" onClick={reset}>
        重试
      </button>
    </main>
  );
}
