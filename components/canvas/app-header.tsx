"use client";
import Link from "next/link";
import { LogOut, FolderOpen } from "lucide-react";
import { Brand } from "./brand";
import { authClient } from "@/lib/auth-client";
export function AppHeader({ name }: { name: string }) {
  return (
    <header className="app-header">
      <Link href="/protected" aria-label="返回创作首页">
        <Brand />
      </Link>
      <nav>
        <Link className="text-button" href="/projects">
          <FolderOpen size={16} />
          我的项目
        </Link>
        <span className="avatar" title={name}>
          {name.slice(0, 1).toUpperCase()}
        </span>
        <button
          className="icon-button"
          title="退出登录"
          aria-label="退出登录"
          onClick={async () => {
            await authClient.signOut();
            window.location.assign("/auth/login");
          }}
        >
          <LogOut size={17} />
        </button>
      </nav>
    </header>
  );
}
