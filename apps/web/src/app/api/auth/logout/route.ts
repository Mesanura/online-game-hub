import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../../server/account-session";
import { logoutAccount } from "../../../../server/auth-service";
import { clearAuthenticatedCookies } from "../../../../server/auth-response";
import {
  isJsonRequest,
  isSameOrigin,
  readJsonBody,
  responseHeaders,
} from "../../../../server/http-auth";
import { getWebServerConfig } from "../../../../server/runtime-config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ code: "REQUEST_FORBIDDEN" }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { code: "CONTENT_TYPE_UNSUPPORTED" },
      { status: 415 },
    );
  }
  const body = await readJsonBody(request);
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  ) {
    return NextResponse.json(
      { code: "INVALID_ACCOUNT_INPUT" },
      { status: 400 },
    );
  }
  try {
    const config = getWebServerConfig();
    await logoutAccount(
      config,
      request.cookies.get(ACCOUNT_SESSION_COOKIE_NAME)?.value,
    );
    const response = new NextResponse(null, {
      status: 204,
      headers: responseHeaders(),
    });
    clearAuthenticatedCookies(response, config);
    return response;
  } catch {
    return NextResponse.json(
      { code: "AUTH_UNAVAILABLE" },
      { status: 503, headers: responseHeaders() },
    );
  }
}
