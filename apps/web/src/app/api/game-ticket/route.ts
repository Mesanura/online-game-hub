import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";

import {
  GUEST_SESSION_COOKIE_NAME,
  createGuestSessionAuthority,
  guestSessionCookieOptions,
  resolveGuestSession,
} from "../../../server/guest-session";
import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../server/account-session";
import { resolveAccountSession } from "../../../server/auth-service";
import { getWebServerConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const config = getWebServerConfig();
    const guestAuthority = createGuestSessionAuthority({
      secret: config.guestSessionSecret,
    });
    const session = resolveGuestSession(
      request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value,
      guestAuthority,
    );
    const accountToken = request.cookies.get(
      ACCOUNT_SESSION_COOKIE_NAME,
    )?.value;
    const account = await resolveAccountSession(config, accountToken);
    const invalidAccountSession =
      accountToken !== undefined && account === null;
    const rotatedGuest = invalidAccountSession ? guestAuthority.create() : null;
    const playerSessionId =
      rotatedGuest?.playerSessionId ?? session.playerSessionId;
    const ticketAuthority = createHmacGameServerTicketAuthority({
      issuer: config.ticketIssuer,
      secret: config.ticketSecret,
      lifetimeSeconds: config.ticketLifetimeSeconds,
    });
    const response = NextResponse.json(
      {
        ticket: ticketAuthority.issue(playerSessionId, account?.userId),
      },
      { headers: { "cache-control": "no-store, private" } },
    );
    const guestCookieValue = rotatedGuest?.token ?? session.cookieValueToSet;
    if (guestCookieValue !== null) {
      response.cookies.set(
        GUEST_SESSION_COOKIE_NAME,
        guestCookieValue,
        guestSessionCookieOptions(config.guestCookieSecure),
      );
    }
    if (invalidAccountSession) {
      response.cookies.set(ACCOUNT_SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: config.guestCookieSecure,
        path: "/",
        maxAge: 0,
      });
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "TICKET_UNAVAILABLE" },
      {
        status: 503,
        headers: { "cache-control": "no-store, private" },
      },
    );
  }
}
