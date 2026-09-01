"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AccountPage() {
  const [account, setAccount] = useState<
    { username: string } | null | undefined
  >(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { account?: { username: string } | null }) =>
        setAccount(payload.account ?? null),
      )
      .catch(() => setAccount(null));
  }, []);
  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    window.location.href = "/";
  }
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setMessage(
      response.ok
        ? "密码已修改，其他设备已退出。"
        : "无法修改密码，请检查当前密码和新密码。",
    );
    if (response.ok) {
      setCurrentPassword("");
      setNewPassword("");
    }
  }
  if (account === undefined) {
    return (
      <div className="page-shell auth-page">
        <p>正在加载账户…</p>
      </div>
    );
  }
  if (account === null)
    return (
      <div className="page-shell auth-page">
        <h1>需要登录</h1>
        <p>账户页面只对登录用户开放。</p>
        <Link className="clay-button clay-button-primary" href="/login">
          去登录
        </Link>
      </div>
    );
  return (
    <div className="page-shell account-page">
      <p className="eyebrow">账户</p>
      <h1>{account.username}</h1>
      <div className="account-actions">
        <Link
          className="clay-button clay-button-primary"
          href="/account/matches"
        >
          我的对局
        </Link>
        <button className="clay-button" onClick={logout}>
          退出登录
        </button>
      </div>
      <form className="auth-form clay-surface" onSubmit={changePassword}>
        <h2>修改密码</h2>
        <label htmlFor="current-password">当前密码</label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          minLength={12}
          maxLength={128}
        />
        <label htmlFor="new-password">新密码</label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          minLength={12}
          maxLength={128}
        />
        {message !== null && <p role="status">{message}</p>}
        <button className="clay-button clay-button-primary" type="submit">
          更新密码
        </button>
      </form>
    </div>
  );
}
