import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../../server/account-session";
import {
  AuthServiceError,
  changeAccountPassword,
  resolveAccountSession,
} from "../../../../server/auth-service";
import { clearAuthenticatedCookies } from "../../../../server/auth-response";
import {
  isJsonRequest,
  isSameOrigin,
  passwordChangeSchema,
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
  const body = passwordChangeSchema.safeParse(await readJsonBody(request));
  if (!body.success) {
    return NextResponse.json(
      { code: "INVALID_ACCOUNT_INPUT" },
      { status: 400 },
    );
  }
  try {
    const config = getWebServerConfig();
    const account = await resolveAccountSession(
      config,
      request.cookies.get(ACCOUNT_SESSION_COOKIE_NAME)?.value,
    );
    if (account === null) {
      const response = NextResponse.json(
        { code: "ACCOUNT_SESSION_REQUIRED" },
        { status: 401, headers: responseHeaders() },
      );
      clearAuthenticatedCookies(response, config);
      return response;
    }
    await changeAccountPassword(
      config,
      account,
      body.data.currentPassword,
      body.data.newPassword,
    );
    return NextResponse.json({ ok: true }, { headers: responseHeaders() });
  } catch (error) {
    const invalid =
      error instanceof AuthServiceError &&
      ["INVALID_INPUT", "PASSWORD_INVALID"].includes(error.code);
    const rejected =
      error instanceof AuthServiceError && error.code === "INVALID_CREDENTIALS";
    return NextResponse.json(
      {
        code: invalid
          ? "INVALID_ACCOUNT_INPUT"
          : rejected
            ? "AUTHENTICATION_FAILED"
            : "AUTH_UNAVAILABLE",
      },
      {
        status: invalid ? 400 : rejected ? 401 : 503,
        headers: responseHeaders(),
      },
    );
  }
}
