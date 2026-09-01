import { createHash, randomBytes } from "node:crypto";

export const ACCOUNT_SESSION_COOKIE_NAME = "ogh_account";
export const ACCOUNT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AccountSessionTokenSource {
  createToken(): string;
}

export interface AccountSessionMaterial {
  readonly token: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

const secureTokenSource: AccountSessionTokenSource = {
  createToken: () => randomBytes(32).toString("base64url"),
};

export function hashAccountSessionToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length < 32 || token.length > 512) {
    return null;
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createAccountSessionMaterial(
  now: Date = new Date(),
  tokenSource: AccountSessionTokenSource = secureTokenSource,
): AccountSessionMaterial {
  if (!Number.isFinite(now.getTime()))
    throw new TypeError("SESSION_TIME_INVALID");
  const token = tokenSource.createToken();
  const tokenHash = hashAccountSessionToken(token);
  if (tokenHash === null) throw new TypeError("SESSION_TOKEN_INVALID");
  return {
    token,
    tokenHash,
    expiresAt: new Date(now.getTime() + ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000),
  };
}

export function accountSessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: ACCOUNT_SESSION_MAX_AGE_SECONDS,
  };
}
