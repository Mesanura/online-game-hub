import type {
  GameServerTicketClaims,
  ProtocolErrorCode,
} from "@online-game-hub/protocol";

declare const playerSessionIdBrand: unique symbol;

export type PlayerSessionId = string & {
  readonly [playerSessionIdBrand]: "PlayerSessionId";
};

export function definePlayerSessionId(value: string): PlayerSessionId {
  if (value.length === 0) {
    throw new TypeError("Player session id must not be empty.");
  }
  return value as PlayerSessionId;
}

export type TicketVerificationFailureCode =
  | "MISSING_TICKET"
  | "INVALID_TICKET"
  | "EXPIRED_TICKET"
  | "WRONG_AUDIENCE"
  | "WRONG_ISSUER"
  | "PROTOCOL_VERSION_UNSUPPORTED";

export type TicketVerificationResult =
  | {
      readonly status: "verified";
      readonly playerSessionId: PlayerSessionId;
      readonly userId: string | null;
      readonly claims: GameServerTicketClaims;
    }
  | {
      readonly status: "rejected";
      readonly code: TicketVerificationFailureCode;
      readonly protocolCode: Extract<
        ProtocolErrorCode,
        "UNAUTHENTICATED" | "PROTOCOL_VERSION_UNSUPPORTED"
      >;
    };

export interface TicketVerifier {
  verify(ticket: unknown): Promise<TicketVerificationResult>;
}
