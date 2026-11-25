"use client";
import Link from "next/link";
import { LogOut, FolderOpen, BookOpen } from "lucide-react";
import { Brand } from "./brand";
import { authClient } from "@/lib/auth-client";
export function AppHeader({ name }: { name?: string }) {
  return (
    <header className="app-header">
      <Link href="/" aria-label="返回创作首页">
        <Brand />
      </Link>
      <nav>
        <Link className="text-button" href="/projects">
          <FolderOpen size={16} />
          {name ? "我的项目" : "全部项目"}
        </Link>
        {name ? (
          <>
            <Link href="/skills" className="text-button">
              <BookOpen size={16} />
              技能库
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
                window.location.assign("/");
              }}
            >
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <>
            <Link className="guest-login" href="/auth/login">
              登录
            </Link>
            <Link className="primary-button" href="/auth/sign-up">
              注册
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
