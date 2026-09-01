import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../../server/account-session";
import {
  publicAccount,
  resolveAccountSession,
} from "../../../../server/auth-service";
import { clearAuthenticatedCookies } from "../../../../server/auth-response";
import { responseHeaders } from "../../../../server/http-auth";
import { getWebServerConfig } from "../../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const config = getWebServerConfig();
    const token = request.cookies.get(ACCOUNT_SESSION_COOKIE_NAME)?.value;
    if (token === undefined) {
      return NextResponse.json(
        { account: null },
        { headers: responseHeaders() },
      );
    }
    const account = await resolveAccountSession(config, token);
    const response = NextResponse.json(
      { account: account === null ? null : publicAccount(account) },
      { headers: responseHeaders() },
    );
    if (account === null) clearAuthenticatedCookies(response, config);
    return response;
  } catch {
    return NextResponse.json(
      { code: "AUTH_UNAVAILABLE" },
      { status: 503, headers: responseHeaders() },
    );
  }
}
