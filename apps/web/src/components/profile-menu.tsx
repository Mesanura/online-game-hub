"use client";

import {
  ArrowRight,
  ClockCounterClockwise,
  Gear,
  SignIn,
  SignOut,
  UserPlus,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";

import {
  DEFAULT_DISPLAY_NAME,
  GUEST_PROFILE_STORAGE_KEY,
  MAX_DISPLAY_NAME_INPUT_LENGTH,
  getAvatarLabel,
  normalizeDisplayName,
  readStoredGuestDisplayName,
} from "../lib/profile";

interface AccountProfile {
  readonly username: string;
  readonly displayName: string;
}

interface ProfileMenuProps {
  readonly confirmIdentityChange: (
    event: MouseEvent<HTMLAnchorElement>,
  ) => void;
}

type ProfileMessage = {
  readonly tone: "error" | "success";
  readonly text: string;
};

function guestStorageValue(displayName: string): string {
  return JSON.stringify({ displayName });
}

export function ProfileMenu({ confirmIdentityChange }: ProfileMenuProps) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [guestDisplayName, setGuestDisplayName] =
    useState(DEFAULT_DISPLAY_NAME);
  const [draftDisplayName, setDraftDisplayName] =
    useState(DEFAULT_DISPLAY_NAME);
  const [message, setMessage] = useState<ProfileMessage | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { account?: AccountProfile | null } | null) => {
        if (!active) return;
        const nextAccount = payload?.account ?? null;
        setAccount(nextAccount);
        if (nextAccount !== null) {
          setDraftDisplayName(nextAccount.displayName);
        } else {
          const nextGuestName = readStoredGuestDisplayName(
            window.localStorage.getItem(GUEST_PROFILE_STORAGE_KEY),
          );
          setGuestDisplayName(nextGuestName);
          setDraftDisplayName(nextGuestName);
        }
      })
      .catch(() => {
        if (!active) return;
        setAccount(null);
        const nextGuestName = readStoredGuestDisplayName(
          window.localStorage.getItem(GUEST_PROFILE_STORAGE_KEY),
        );
        setGuestDisplayName(nextGuestName);
        setDraftDisplayName(nextGuestName);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  useEffect(() => {
    function closeOnOutside(event: globalThis.MouseEvent) {
      if (menuRef.current?.contains(event.target as Node) !== true) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const displayName = account?.displayName ?? guestDisplayName;
  const avatarLabel = getAvatarLabel(draftDisplayName);

  function openMenu() {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
    setMessage(null);
  }

  function scheduleClose() {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 140);
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    setOpen(false);
  }

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextDisplayName = normalizeDisplayName(draftDisplayName);
    if (nextDisplayName === null) {
      setMessage({
        tone: "error",
        text: "显示名不能为空，且不能包含控制字符。",
      });
      return;
    }
    setPending(true);
    setMessage(null);
    if (account === null) {
      try {
        window.localStorage.setItem(
          GUEST_PROFILE_STORAGE_KEY,
          guestStorageValue(nextDisplayName),
        );
        setGuestDisplayName(nextDisplayName);
        setDraftDisplayName(nextDisplayName);
        setMessage({ tone: "success", text: "显示名已保存。" });
      } catch {
        setMessage({ tone: "error", text: "当前浏览器无法保存显示名。" });
      } finally {
        setPending(false);
      }
      return;
    }
    void fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: nextDisplayName }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("PROFILE_UPDATE_FAILED");
        const payload = (await response.json()) as {
          account?: AccountProfile;
        };
        if (payload.account === undefined)
          throw new Error("PROFILE_RESPONSE_INVALID");
        setAccount(payload.account);
        setDraftDisplayName(payload.account.displayName);
        setMessage({ tone: "success", text: "显示名已保存。" });
      })
      .catch(() => {
        setMessage({ tone: "error", text: "保存失败，请稍后重试。" });
      })
      .finally(() => setPending(false));
  }

  async function logout() {
    if (
      pathname.includes("/rooms/") &&
      !window.confirm(
        "账户操作会轮换当前身份。离开后将无法恢复本房间席位，是否继续？",
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      setAccount(null);
      const nextGuestName = readStoredGuestDisplayName(
        window.localStorage.getItem(GUEST_PROFILE_STORAGE_KEY),
      );
      setGuestDisplayName(nextGuestName);
      setDraftDisplayName(nextGuestName);
      setOpen(false);
      window.location.href = "/";
    } catch {
      setPending(false);
      setMessage({ tone: "error", text: "退出失败，请稍后重试。" });
    }
  }

  return (
    <div
      className={`profile-menu ${open ? "is-open" : ""}`}
      ref={menuRef}
      onBlur={handleBlur}
      onFocus={openMenu}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="打开个人资料菜单"
        className="profile-trigger"
        onClick={openMenu}
        ref={triggerRef}
        type="button"
      >
        <span className="profile-avatar" aria-hidden="true">
          {avatarLabel}
        </span>
      </button>
      {open ? (
        <div className="profile-popover" role="dialog" aria-label="个人资料">
          <div className="profile-popover-main">
            <div
              className="profile-avatar profile-avatar-large"
              aria-hidden="true"
            >
              {avatarLabel}
            </div>
            <div className="profile-copy">
              <strong>{displayName}</strong>
              {account === null ? (
                <span>游客 · 本机资料</span>
              ) : (
                <span>账号：{account.username}</span>
              )}
            </div>
          </div>
          <form className="profile-form" onSubmit={submitProfile}>
            <label htmlFor="profile-display-name">显示名</label>
            <div className="profile-input-row">
              <input
                id="profile-display-name"
                maxLength={MAX_DISPLAY_NAME_INPUT_LENGTH}
                onChange={(event) => setDraftDisplayName(event.target.value)}
                value={draftDisplayName}
              />
              <button
                aria-label="保存显示名"
                className="profile-save-button"
                disabled={pending}
                title="保存显示名"
                type="submit"
              >
                <ArrowRight size={18} weight="bold" aria-hidden="true" />
              </button>
            </div>
            {message !== null ? (
              <p className={`profile-message is-${message.tone}`} role="status">
                {message.text}
              </p>
            ) : null}
          </form>
          <div className="profile-menu-actions">
            {account === null ? (
              <>
                <Link
                  className="profile-menu-action"
                  href="/login"
                  onClick={confirmIdentityChange}
                >
                  <SignIn size={18} weight="bold" aria-hidden="true" /> 登录
                </Link>
                <Link
                  className="profile-menu-action"
                  href="/register"
                  onClick={confirmIdentityChange}
                >
                  <UserPlus size={18} weight="bold" aria-hidden="true" /> 注册
                </Link>
              </>
            ) : (
              <>
                <Link
                  className="profile-menu-action"
                  href="/account/matches"
                  onClick={confirmIdentityChange}
                >
                  <ClockCounterClockwise
                    size={18}
                    weight="bold"
                    aria-hidden="true"
                  />{" "}
                  历史对局
                </Link>
                <Link
                  className="profile-menu-action"
                  href="/account"
                  onClick={confirmIdentityChange}
                >
                  <Gear size={18} weight="bold" aria-hidden="true" /> 账号设置
                </Link>
                <button
                  className="profile-menu-action"
                  disabled={pending}
                  onClick={() => void logout()}
                  type="button"
                >
                  <SignOut size={18} weight="bold" aria-hidden="true" />{" "}
                  退出登录
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
