"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoaderCircle, ArrowLeft } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Brand } from "./brand";
import { authReturnPath } from "@/lib/auth-return";
export function AuthForm({
  mode,
  mailConfigured,
}: {
  mode: "login" | "signup" | "forgot" | "reset";
  mailConfigured: boolean;
}) {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const title = {
    login: "欢迎回来",
    signup: "开始你的创作",
    forgot: "找回密码",
    reset: "设置新密码",
  }[mode];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              email,
              password,
              name,
              callbackURL: authReturnPath(params.get("next")),
            })
          : mode === "login"
            ? await authClient.signIn.email({ email, password })
            : mode === "forgot"
              ? await authClient.requestPasswordReset({
                  email,
                  redirectTo: "/auth/update-password",
                })
              : await authClient.resetPassword({
                  newPassword: password,
                  token: params.get("token") || "",
                });
      if (result.error) {
        setError(
          mode === "login"
            ? "登录失败，请检查邮箱和密码"
            : result.error.message || "操作失败，请重试",
        );
        return;
      }
      if (mode === "login" || mode === "signup") {
        window.location.assign(authReturnPath(params.get("next")));
        return;
      }
      setMessage(
        mode === "forgot"
          ? "如果该邮箱已注册，你将收到密码重置邮件。"
          : "密码已更新，请使用新密码登录。",
      );
    } catch {
      setError("暂时无法连接服务，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <Link href="/" className="auth-brand">
        <Brand />
      </Link>
      <section className="auth-card">
        <h1>{title}</h1>
        <p className="auth-subtitle">把每一个想法，变成你的作品。</p>
        {!mailConfigured && mode === "forgot" && (
          <p className="notice">
            密码重置邮件服务尚未配置，请联系管理员完成配置。注册和登录不受影响。
          </p>
        )}
        {params.get("error") && (
          <p className="inline-error">链接无效或已过期，请重新申请密码重置。</p>
        )}
        {message ? (
          <div className="success-message" role="status">
            {message}
            <Link className="primary-button" href="/auth/login">
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                昵称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={50}
                  autoComplete="name"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                邮箱
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "login" ? 1 : 10}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "login" ? "输入你的密码" : "至少 10 个字符"
                  }
                />
              </label>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button"
              disabled={busy || (!mailConfigured && mode === "forgot")}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : null}
              {mode === "login"
                ? "登录"
                : mode === "signup"
                  ? "创建账号"
                  : mode === "forgot"
                    ? "发送重置邮件"
                    : "更新密码"}
            </button>
          </form>
        )}
        <div className="auth-links">
          {mode === "login" ? (
            <>
              <Link href="/auth/forgot-password">忘记密码？</Link>
              <Link
                href={
                  params.get("next")
                    ? `/auth/sign-up?next=${encodeURIComponent(authReturnPath(params.get("next")))}`
                    : "/auth/sign-up"
                }
              >
                注册新账号
              </Link>
            </>
          ) : (
            <Link
              href={
                params.get("next")
                  ? `/auth/login?next=${encodeURIComponent(authReturnPath(params.get("next")))}`
                  : "/auth/login"
              }
            >
              <ArrowLeft size={14} />
              返回登录
            </Link>
          )}
        </div>
      </section>
      <p className="auth-footer">AI Canvas · 为你的想法留一块画布</p>
    </main>
  );
}
