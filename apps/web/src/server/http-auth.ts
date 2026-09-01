import { z } from "zod";

import { ACCOUNT_SESSION_COOKIE_NAME } from "./account-session";

export const authRequestSchema = z
  .object({ username: z.unknown(), password: z.unknown() })
  .strict();

export const passwordChangeSchema = z
  .object({ currentPassword: z.unknown(), newPassword: z.unknown() })
  .strict();

const MAX_BODY_BYTES = 4096;

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host") ?? requestUrl.host;
    return (
      originUrl.protocol === requestUrl.protocol && originUrl.host === host
    );
  } catch {
    return false;
  }
}

export function isJsonRequest(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() ===
    "application/json"
  );
}

export async function readJsonBody(request: Request): Promise<unknown | null> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)
  ) {
    return null;
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export function authCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  };
}

export function clearAuthCookieOptions(secure: boolean) {
  return { ...authCookieOptions(secure), maxAge: 0 };
}

export function responseHeaders() {
  return { "cache-control": "no-store, private", vary: "Cookie" };
}

export function currentAccountCookie(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${ACCOUNT_SESSION_COOKIE_NAME}=([^;]+)`),
  );
  return match?.[1];
}
