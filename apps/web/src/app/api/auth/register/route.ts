import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  registerAccount,
  publicAccount,
} from "../../../../server/auth-service";
import { AuthServiceError } from "../../../../server/auth-service";
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
  if (!accountAuthRateLimiter.consume(authRateLimitKey(request, "register"))) {
    return NextResponse.json(
      { code: "AUTH_RATE_LIMITED" },
      { status: 429, headers: responseHeaders() },
    );
  }
  const body = authRequestSchema.safeParse(await readJsonBody(request));
  if (!body.success) {
    return NextResponse.json(
      { code: "INVALID_ACCOUNT_INPUT" },
      { status: 400, headers: responseHeaders() },
    );
  }
  try {
    const config = getWebServerConfig();
    const account = await registerAccount(
      config,
      body.data.username,
      body.data.password,
    );
    if (account.sessionToken === null) throw new Error("SESSION_NOT_ISSUED");
    const response = NextResponse.json(
      { account: publicAccount(account) },
      { status: 201, headers: responseHeaders() },
    );
    setAuthenticatedCookies(response, config, account.sessionToken);
    return response;
  } catch (error) {
    const invalid =
      error instanceof AuthServiceError &&
      ["INVALID_INPUT", "PASSWORD_INVALID"].includes(error.code);
    const unavailable =
      error instanceof AuthServiceError &&
      error.code === "USERNAME_UNAVAILABLE";
    return NextResponse.json(
      {
        code: invalid
          ? "INVALID_ACCOUNT_INPUT"
          : unavailable
            ? "ACCOUNT_CREATION_FAILED"
            : "AUTH_UNAVAILABLE",
      },
      {
        status: invalid ? 400 : unavailable ? 409 : 503,
        headers: responseHeaders(),
      },
    );
  }
}
