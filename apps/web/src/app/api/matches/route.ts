import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../server/account-session";
import { resolveAccountSession } from "../../../server/auth-service";
import { clearAuthenticatedCookies } from "../../../server/auth-response";
import { listUserMatchHistory } from "../../../server/match-history";
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
    const accountToken = request.cookies.get(
      ACCOUNT_SESSION_COOKIE_NAME,
    )?.value;
    const account = await resolveAccountSession(config, accountToken);
    if (account === null) {
      const response = NextResponse.json(
        { code: "ACCOUNT_SESSION_REQUIRED" },
        { status: 401, headers: PRIVATE_HEADERS },
      );
      if (accountToken !== undefined) {
        clearAuthenticatedCookies(response, config);
      }
      return response;
    }
    const matches = await listUserMatchHistory(config, account.userId);
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
