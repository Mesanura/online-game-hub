import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";
import {
  SETUP_PROTOCOL_VERSION,
  normalizePlayerDisplayName,
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

const ticketRequestSchema = z
  .object({
    protocolVersion: setupProtocolGenerationSchema,
    displayName: z.string().optional(),
  })
  .strict();

async function requestedTicket(request: NextRequest): Promise<
  | {
      protocolVersion: SetupProtocolGeneration;
      displayName?: string;
    }
  | "unsupported"
  | null
> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 4096) return null;
  if (text.trim().length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "protocolVersion" in value &&
    typeof value.protocolVersion === "number" &&
    value.protocolVersion !== SETUP_PROTOCOL_VERSION
  ) {
    return "unsupported";
  }
  const parsed = ticketRequestSchema.safeParse(value);
  if (!parsed.success) return null;
  const { protocolVersion, displayName } = parsed.data;
  if (displayName === undefined) return { protocolVersion };
  const normalized = normalizePlayerDisplayName(displayName);
  return normalized === null
    ? null
    : { protocolVersion, displayName: normalized };
}

export async function POST(request: NextRequest) {
  try {
    const requested = await requestedTicket(request);
    if (requested === "unsupported") {
      return NextResponse.json(
        { code: "PROTOCOL_VERSION_UNSUPPORTED" },
        { status: 400, headers: { "cache-control": "no-store, private" } },
      );
    }
    if (requested === null) {
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
          requested.protocolVersion,
          requested.displayName === undefined
            ? undefined
            : (account?.displayName ?? requested.displayName),
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
