import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const GUEST_SESSION_COOKIE_NAME = "ogh_guest";
export const GUEST_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;

export interface GuestSessionTimeSource {
  nowSeconds(): number;
}

export interface GuestSessionIdSource {
  createPlayerSessionId(): string;
}

export interface GuestSessionAuthorityOptions {
  readonly secret: string;
  readonly time?: GuestSessionTimeSource;
  readonly ids?: GuestSessionIdSource;
  readonly maxAgeSeconds?: number;
}

export type GuestSessionVerificationResult =
  | { readonly status: "verified"; readonly playerSessionId: string }
  | { readonly status: "rejected" };

export interface GuestSessionAuthority {
  create(): { readonly token: string; readonly playerSessionId: string };
  verify(token: unknown): GuestSessionVerificationResult;
}

export interface ResolvedGuestSession {
  readonly playerSessionId: string;
  readonly cookieValueToSet: string | null;
}

const systemTime: GuestSessionTimeSource = {
  nowSeconds: () => Math.floor(Date.now() / 1000),
};

const secureIds: GuestSessionIdSource = {
  createPlayerSessionId: () => `guest_${randomUUID()}`,
};

function canonicalDecode(segment: string): Buffer | null {
  if (!BASE64URL_SEGMENT.test(segment)) return null;
  const decoded = Buffer.from(segment, "base64url");
  return decoded.toString("base64url") === segment ? decoded : null;
}

export function createGuestSessionAuthority(
  options: GuestSessionAuthorityOptions,
): GuestSessionAuthority {
  if (Buffer.byteLength(options.secret, "utf8") < 32) {
    throw new TypeError(
      "Guest session secret must contain at least 32 UTF-8 bytes.",
    );
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? GUEST_SESSION_MAX_AGE_SECONDS;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError("Guest session max age must be a positive integer.");
  }
  const time = options.time ?? systemTime;
  const ids = options.ids ?? secureIds;
  const secret = Buffer.from(options.secret, "utf8");
  const sign = (payload: string): Buffer =>
    createHmac("sha256", secret).update(payload).digest();

  return {
    create() {
      const issuedAt = time.nowSeconds();
      const playerSessionId = ids.createPlayerSessionId();
      if (
        !Number.isSafeInteger(issuedAt) ||
        issuedAt < 0 ||
        playerSessionId.length === 0 ||
        playerSessionId.length > 128
      ) {
        throw new Error("Guest session sources returned invalid values.");
      }
      const payload = Buffer.from(
        JSON.stringify({ version: 1, playerSessionId, issuedAt }),
        "utf8",
      ).toString("base64url");
      return {
        token: `${payload}.${sign(payload).toString("base64url")}`,
        playerSessionId,
      };
    },

    verify(token) {
      if (
        typeof token !== "string" ||
        token.length === 0 ||
        token.length > 1024
      ) {
        return { status: "rejected" };
      }
      const segments = token.split(".");
      if (segments.length !== 2) return { status: "rejected" };
      const [payload, signature] = segments;
      if (payload === undefined || signature === undefined) {
        return { status: "rejected" };
      }
      const payloadBytes = canonicalDecode(payload);
      const signatureBytes = canonicalDecode(signature);
      const expected = sign(payload);
      if (
        payloadBytes === null ||
        signatureBytes === null ||
        signatureBytes.length !== expected.length ||
        !timingSafeEqual(signatureBytes, expected)
      ) {
        return { status: "rejected" };
      }
      let claims: unknown;
      try {
        claims = JSON.parse(payloadBytes.toString("utf8")) as unknown;
      } catch {
        return { status: "rejected" };
      }
      if (
        claims === null ||
        typeof claims !== "object" ||
        Array.isArray(claims) ||
        Object.keys(claims).length !== 3
      ) {
        return { status: "rejected" };
      }
      const candidate = claims as Record<string, unknown>;
      if (
        candidate.version !== 1 ||
        typeof candidate.playerSessionId !== "string" ||
        candidate.playerSessionId.length === 0 ||
        candidate.playerSessionId.length > 128 ||
        typeof candidate.issuedAt !== "number" ||
        !Number.isSafeInteger(candidate.issuedAt)
      ) {
        return { status: "rejected" };
      }
      const now = time.nowSeconds();
      if (
        !Number.isSafeInteger(now) ||
        candidate.issuedAt > now ||
        now - candidate.issuedAt >= maxAgeSeconds
      ) {
        return { status: "rejected" };
      }
      return {
        status: "verified",
        playerSessionId: candidate.playerSessionId,
      };
    },
  };
}

export function resolveGuestSession(
  cookieValue: unknown,
  authority: GuestSessionAuthority,
): ResolvedGuestSession {
  const existing = authority.verify(cookieValue);
  if (existing.status === "verified") {
    return {
      playerSessionId: existing.playerSessionId,
      cookieValueToSet: null,
    };
  }
  const created = authority.create();
  return {
    playerSessionId: created.playerSessionId,
    cookieValueToSet: created.token,
  };
}

export function guestSessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
  };
}
