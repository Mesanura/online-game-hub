import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  AuthServiceError,
  loginAccount,
  publicAccount,
} from "../../../../server/auth-service";
import {
  accountAuthRateLimiter,
  authRateLimitKey,
} from "../../../../server/auth-rate-limit";
import { setAuthenticatedCookies } from "../../../../server/auth-response";
import {
  authRequestSchema,
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
  if (!accountAuthRateLimiter.consume(authRateLimitKey(request, "login"))) {
    return NextResponse.json(
      { code: "AUTH_RATE_LIMITED" },
      { status: 429, headers: responseHeaders() },
    );
  }
  const body = authRequestSchema.safeParse(await readJsonBody(request));
  if (!body.success) {
    return NextResponse.json(
      { code: "AUTHENTICATION_FAILED" },
      { status: 401, headers: responseHeaders() },
    );
  }
  try {
    const config = getWebServerConfig();
    const account = await loginAccount(
      config,
      body.data.username,
      body.data.password,
    );
    if (account.sessionToken === null) throw new Error("SESSION_NOT_ISSUED");
    const response = NextResponse.json(
      { account: publicAccount(account) },
      { headers: responseHeaders() },
    );
    setAuthenticatedCookies(response, config, account.sessionToken);
    return response;
  } catch (error) {
    const rejected =
      error instanceof AuthServiceError && error.code === "INVALID_CREDENTIALS";
    return NextResponse.json(
      { code: rejected ? "AUTHENTICATION_FAILED" : "AUTH_UNAVAILABLE" },
      { status: rejected ? 401 : 503, headers: responseHeaders() },
    );
  }
}
