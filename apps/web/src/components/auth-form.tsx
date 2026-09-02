"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

export function AuthForm({ mode }: { readonly mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(
          mode === "login"
            ? "用户名或密码不正确。"
            : "无法创建账户，请检查输入或稍后重试。",
        );
        return;
      }
      const next = new URL(window.location.href).searchParams.get("next");
      let destination = "/account";
      if (next !== null && next.startsWith("/") && !next.startsWith("//")) {
        const target = new URL(next, window.location.origin);
        if (target.origin === window.location.origin) {
          destination = `${target.pathname}${target.search}${target.hash}`;
        }
      }
      router.push(destination);
      router.refresh();
    } catch {
      setError("服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form clay-surface" onSubmit={submit}>
      <label htmlFor="username">用户名</label>
      <input
        id="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
        required
        minLength={3}
        maxLength={24}
      />
      <label htmlFor="password">密码</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        minLength={8}
        maxLength={128}
      />
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button
        className="clay-button clay-button-primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "处理中…" : mode === "login" ? "登录" : "创建账户"}
      </button>
      <p className="form-hint">
        {mode === "login" ? (
          <>
            还没有账户？ <Link href="/register">注册</Link>
          </>
        ) : (
          <>
            已有账户？ <Link href="/login">登录</Link>
          </>
        )}
      </p>
    </form>
  );
}
