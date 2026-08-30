import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  GUEST_SESSION_COOKIE_NAME,
  createGuestSessionAuthority,
} from "../../../server/guest-session";
import { listGuestMatchHistory } from "../../../server/match-history";
import { getWebServerConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "cache-control": "no-store, private",
  vary: "Cookie",
} as const;

export async function GET(request: NextRequest) {
  try {
    const config = getWebServerConfig();
    const authority = createGuestSessionAuthority({
      secret: config.guestSessionSecret,
    });
    const session = authority.verify(
      request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value,
    );
    if (session.status !== "verified") {
      return NextResponse.json(
        { code: "GUEST_SESSION_REQUIRED" },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }
    const matches = await listGuestMatchHistory(
      config,
      session.playerSessionId,
    );
    return NextResponse.json(
      { matches },
      { status: 200, headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { code: "MATCH_HISTORY_UNAVAILABLE" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
