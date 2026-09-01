import {
  createHmacGameServerTicketAuthority,
  type HmacGameServerTicketOptions,
} from "@online-game-hub/game-server-ticket";
import {
  definePlayerSessionId,
  type TicketVerifier,
} from "@online-game-hub/game-server-runtime";

export type GameServerTicketVerifierOptions = Pick<
  HmacGameServerTicketOptions,
  "issuer" | "secret" | "time"
>;

export function createGameServerTicketVerifier(
  options: GameServerTicketVerifierOptions,
): TicketVerifier {
  const authority = createHmacGameServerTicketAuthority(options);
  return {
    async verify(ticket) {
      const verification = authority.verify(ticket);
      if (verification.status === "rejected") {
        return {
          status: "rejected",
          code: verification.code,
          protocolCode:
            verification.code === "PROTOCOL_VERSION_UNSUPPORTED"
              ? "PROTOCOL_VERSION_UNSUPPORTED"
              : "UNAUTHENTICATED",
        };
      }
      return {
        status: "verified",
        playerSessionId: definePlayerSessionId(
          verification.claims.playerSessionId,
        ),
        userId: verification.claims.userId ?? null,
        claims: verification.claims,
      };
    },
  };
}
