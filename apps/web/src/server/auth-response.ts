import type { NextResponse } from "next/server";

import {
  ACCOUNT_SESSION_COOKIE_NAME,
  accountSessionCookieOptions,
} from "./account-session";
import {
  GUEST_SESSION_COOKIE_NAME,
  createGuestSessionAuthority,
  guestSessionCookieOptions,
} from "./guest-session";
import type { WebServerConfig } from "./config";

export function rotateGuestCookie(
  response: NextResponse,
  config: WebServerConfig,
): string {
  const guest = createGuestSessionAuthority({
    secret: config.guestSessionSecret,
  }).create();
  response.cookies.set(
    GUEST_SESSION_COOKIE_NAME,
    guest.token,
    guestSessionCookieOptions(config.guestCookieSecure),
  );
  return guest.playerSessionId;
}

export function setAuthenticatedCookies(
  response: NextResponse,
  config: WebServerConfig,
  accountToken: string,
): void {
  response.cookies.set(
    ACCOUNT_SESSION_COOKIE_NAME,
    accountToken,
    accountSessionCookieOptions(config.guestCookieSecure),
  );
  rotateGuestCookie(response, config);
}

export function clearAuthenticatedCookies(
  response: NextResponse,
  config: WebServerConfig,
): void {
  response.cookies.set(ACCOUNT_SESSION_COOKIE_NAME, "", {
    ...accountSessionCookieOptions(config.guestCookieSecure),
    maxAge: 0,
  });
  rotateGuestCookie(response, config);
}
