import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  GAME_SERVER_TICKET_AUDIENCE,
  PROTOCOL_VERSION,
  gameServerTicketClaimsSchema,
} from "@online-game-hub/protocol";
import type { GameServerTicketClaims } from "@online-game-hub/protocol";

const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_TICKET_BYTES = 4096;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;

export interface TicketTimeSource {
  nowSeconds(): number;
}

export interface TicketIdSource {
  createTicketId(): string;
}

export const systemTicketTimeSource: TicketTimeSource = {
  nowSeconds: () => Math.floor(Date.now() / 1000),
};

export const secureTicketIdSource: TicketIdSource = {
  createTicketId: () => randomUUID(),
};

export interface HmacGameServerTicketOptions {
  readonly issuer: string;
  readonly secret: string;
  readonly lifetimeSeconds?: number;
  readonly time?: TicketTimeSource;
  readonly ids?: TicketIdSource;
}

export type GameServerTicketVerificationFailureCode =
  | "MISSING_TICKET"
  | "INVALID_TICKET"
  | "EXPIRED_TICKET"
  | "WRONG_AUDIENCE"
  | "WRONG_ISSUER"
  | "PROTOCOL_VERSION_UNSUPPORTED";

export type GameServerTicketVerificationResult =
  | {
      readonly status: "verified";
      readonly claims: GameServerTicketClaims;
    }
  | {
      readonly status: "rejected";
      readonly code: GameServerTicketVerificationFailureCode;
    };

export interface GameServerTicketAuthority {
  issue(playerSessionId: string, userId?: string): string;
  verify(ticket: unknown): GameServerTicketVerificationResult;
}

function assertOptions(options: HmacGameServerTicketOptions): void {
  if (options.issuer.length === 0 || options.issuer.length > 128) {
    throw new TypeError(
      "Ticket issuer must contain between 1 and 128 characters.",
    );
  }
  if (Buffer.byteLength(options.secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new TypeError("Ticket secret must contain at least 32 UTF-8 bytes.");
  }
  const lifetimeSeconds = options.lifetimeSeconds ?? 30;
  if (
    !Number.isSafeInteger(lifetimeSeconds) ||
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > 300
  ) {
    throw new RangeError(
      "Ticket lifetime must be an integer from 1 to 300 seconds.",
    );
  }
}

function canonicalBase64UrlDecode(segment: string): Buffer | null {
  if (!BASE64URL_SEGMENT.test(segment)) {
    return null;
  }
  const decoded = Buffer.from(segment, "base64url");
  return decoded.toString("base64url") === segment ? decoded : null;
}

export function createHmacGameServerTicketAuthority(
  options: HmacGameServerTicketOptions,
): GameServerTicketAuthority {
  assertOptions(options);
  const lifetimeSeconds = options.lifetimeSeconds ?? 30;
  const time = options.time ?? systemTicketTimeSource;
  const ids = options.ids ?? secureTicketIdSource;
  const secret = Buffer.from(options.secret, "utf8");

  const sign = (payload: string): string =>
    createHmac("sha256", secret).update(payload).digest("base64url");

  const reject = (
    code: GameServerTicketVerificationFailureCode,
  ): GameServerTicketVerificationResult => ({ status: "rejected", code });

  return {
    issue(playerSessionId, userId) {
      if (playerSessionId.length === 0 || playerSessionId.length > 128) {
        throw new TypeError(
          "Player session id must contain between 1 and 128 characters.",
        );
      }
      const issuedAt = time.nowSeconds();
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new RangeError(
          "Ticket time source returned an invalid timestamp.",
        );
      }
      const claims = gameServerTicketClaimsSchema.parse({
        issuer: options.issuer,
        audience: GAME_SERVER_TICKET_AUDIENCE,
        playerSessionId,
        ...(userId === undefined ? {} : { userId }),
        issuedAt,
        expiresAt: issuedAt + lifetimeSeconds,
        ticketId: ids.createTicketId(),
        protocolVersion: PROTOCOL_VERSION,
      });
      const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
        "base64url",
      );
      return `${payload}.${sign(payload)}`;
    },

    verify(ticket) {
      if (ticket === undefined || ticket === null || ticket === "") {
        return reject("MISSING_TICKET");
      }
      if (
        typeof ticket !== "string" ||
        Buffer.byteLength(ticket, "utf8") > MAXIMUM_TICKET_BYTES
      ) {
        return reject("INVALID_TICKET");
      }
      const segments = ticket.split(".");
      if (segments.length !== 2) {
        return reject("INVALID_TICKET");
      }
      const [payload, suppliedSignature] = segments;
      if (payload === undefined || suppliedSignature === undefined) {
        return reject("INVALID_TICKET");
      }
      const payloadBytes = canonicalBase64UrlDecode(payload);
      const signatureBytes = canonicalBase64UrlDecode(suppliedSignature);
      const expectedSignature = Buffer.from(sign(payload), "base64url");
      if (
        payloadBytes === null ||
        signatureBytes === null ||
        signatureBytes.length !== expectedSignature.length ||
        !timingSafeEqual(signatureBytes, expectedSignature)
      ) {
        return reject("INVALID_TICKET");
      }

      let rawClaims: unknown;
      try {
        rawClaims = JSON.parse(payloadBytes.toString("utf8")) as unknown;
      } catch {
        return reject("INVALID_TICKET");
      }
      if (rawClaims === null || typeof rawClaims !== "object") {
        return reject("INVALID_TICKET");
      }
      const candidate = rawClaims as Record<string, unknown>;
      if (candidate.protocolVersion !== PROTOCOL_VERSION) {
        return reject("PROTOCOL_VERSION_UNSUPPORTED");
      }
      if (candidate.audience !== GAME_SERVER_TICKET_AUDIENCE) {
        return reject("WRONG_AUDIENCE");
      }
      if (candidate.issuer !== options.issuer) {
        return reject("WRONG_ISSUER");
      }
      const parsed = gameServerTicketClaimsSchema.safeParse(candidate);
      if (!parsed.success) {
        return reject("INVALID_TICKET");
      }
      const nowSeconds = time.nowSeconds();
      if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
        return reject("INVALID_TICKET");
      }
      if (parsed.data.expiresAt <= nowSeconds) {
        return reject("EXPIRED_TICKET");
      }
      if (parsed.data.issuedAt > nowSeconds) {
        return reject("INVALID_TICKET");
      }
      return { status: "verified", claims: parsed.data };
    },
  };
}
