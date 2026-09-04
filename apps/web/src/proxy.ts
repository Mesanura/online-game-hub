import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  GUEST_SESSION_COOKIE_NAME,
  createGuestSessionAuthority,
  guestSessionCookieOptions,
  resolveGuestSession,
} from "./server/guest-session";
import { getWebServerConfig } from "./server/runtime-config";

export function proxy(request: NextRequest) {
  try {
    const config = getWebServerConfig();
    const authority = createGuestSessionAuthority({
      secret: config.guestSessionSecret,
    });
    const session = resolveGuestSession(
      request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value,
      authority,
    );
    const response = NextResponse.next();
    if (session.cookieValueToSet !== null) {
      response.cookies.set(
        GUEST_SESSION_COOKIE_NAME,
        session.cookieValueToSet,
        guestSessionCookieOptions(config.guestCookieSecure),
      );
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "WEB_CONFIGURATION_ERROR" },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|game-surfaces/).*)"],
};
