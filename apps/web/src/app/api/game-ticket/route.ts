import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";

import {
  GUEST_SESSION_COOKIE_NAME,
  createGuestSessionAuthority,
  guestSessionCookieOptions,
  resolveGuestSession,
} from "../../../server/guest-session";
import { getWebServerConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  try {
    const config = getWebServerConfig();
    const guestAuthority = createGuestSessionAuthority({
      secret: config.guestSessionSecret,
    });
    const session = resolveGuestSession(
      request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value,
      guestAuthority,
    );
    const ticketAuthority = createHmacGameServerTicketAuthority({
      issuer: config.ticketIssuer,
      secret: config.ticketSecret,
      lifetimeSeconds: config.ticketLifetimeSeconds,
    });
    const response = NextResponse.json(
      { ticket: ticketAuthority.issue(session.playerSessionId) },
      { headers: { "cache-control": "no-store, private" } },
    );
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
      { code: "TICKET_UNAVAILABLE" },
      {
        status: 503,
        headers: { "cache-control": "no-store, private" },
      },
    );
  }
}
