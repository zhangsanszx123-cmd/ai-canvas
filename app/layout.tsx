import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: "AI Canvas — 让创作更简单",
  description: "在画布上实现你的创意，用 GPT Image2 和 Nano Banana 创作图片。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Suspense fallback={<div className="page-loading">正在加载…</div>}>
          {children}
        </Suspense>
      </body>
    </html>
  );
}
