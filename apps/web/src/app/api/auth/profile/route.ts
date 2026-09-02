import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../../server/account-session";
import {
  AuthServiceError,
  resolveAccountSession,
  updateAccountProfile,
} from "../../../../server/auth-service";
import { clearAuthenticatedCookies } from "../../../../server/auth-response";
import {
  isJsonRequest,
  isSameOrigin,
  profileUpdateSchema,
  readJsonBody,
  responseHeaders,
} from "../../../../server/http-auth";
import { getWebServerConfig } from "../../../../server/runtime-config";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ code: "REQUEST_FORBIDDEN" }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { code: "CONTENT_TYPE_UNSUPPORTED" },
      { status: 415 },
    );
  }
  const body = profileUpdateSchema.safeParse(await readJsonBody(request));
  if (!body.success) {
    return NextResponse.json(
      { code: "INVALID_ACCOUNT_INPUT" },
      { status: 400, headers: responseHeaders() },
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
    const updated = await updateAccountProfile(
      config,
      account,
      body.data.displayName,
    );
    return NextResponse.json(
      { account: updated },
      { status: 200, headers: responseHeaders() },
    );
  } catch (error) {
    const invalid =
      error instanceof AuthServiceError && error.code === "INVALID_INPUT";
    return NextResponse.json(
      { code: invalid ? "INVALID_ACCOUNT_INPUT" : "AUTH_UNAVAILABLE" },
      {
        status: invalid ? 400 : 503,
        headers: responseHeaders(),
      },
    );
  }
}
