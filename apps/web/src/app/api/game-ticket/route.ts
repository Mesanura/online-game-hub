import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";
import {
  PROTOCOL_VERSION,
  setupProtocolGenerationSchema,
} from "@online-game-hub/protocol";
import type { SetupProtocolGeneration } from "@online-game-hub/protocol";

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

async function requestedProtocolGeneration(
  request: NextRequest,
): Promise<SetupProtocolGeneration | null> {
  const text = await request.text();
  if (text.trim().length === 0) return PROTOCOL_VERSION;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("protocolVersion" in value)
  ) {
    return null;
  }
  const parsed = setupProtocolGenerationSchema.safeParse(
    (value as { readonly protocolVersion?: unknown }).protocolVersion,
  );
  return parsed.success ? parsed.data : null;
}

export async function POST(request: NextRequest) {
  try {
    const protocolVersion = await requestedProtocolGeneration(request);
    if (protocolVersion === null) {
      return NextResponse.json(
        { code: "INVALID_TICKET_REQUEST" },
        {
          status: 400,
          headers: { "cache-control": "no-store, private" },
        },
      );
    }
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
        ticket: ticketAuthority.issue(
          playerSessionId,
          account?.userId,
          protocolVersion,
        ),
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
