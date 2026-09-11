import {
  SETUP_PROTOCOL_VERSION,
  gameServerTicketSchema,
  setupProtocolGenerationSchema,
} from "@online-game-hub/protocol";
import type { SetupProtocolGeneration } from "@online-game-hub/protocol";

export type GameServerTicketProvider = (
  protocolVersion?: SetupProtocolGeneration,
) => Promise<string>;

export class TicketRequestError extends Error {
  public constructor(
    public readonly code:
      "TICKET_ERROR" | "PROTOCOL_VERSION_UNSUPPORTED" = "TICKET_ERROR",
  ) {
    super(
      code === "PROTOCOL_VERSION_UNSUPPORTED"
        ? code
        : "A new Game Server ticket could not be obtained.",
    );
    this.name = "TicketRequestError";
  }
}

export function createHttpTicketProvider(
  endpoint = "/api/game-ticket",
  fetchImplementation: typeof fetch = globalThis.fetch,
): GameServerTicketProvider {
  return async (protocolVersion = SETUP_PROTOCOL_VERSION) => {
    try {
      const generation = setupProtocolGenerationSchema.parse(protocolVersion);
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ protocolVersion: generation }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        throw new TicketRequestError(
          payload !== null &&
            typeof payload === "object" &&
            "code" in payload &&
            payload.code === "PROTOCOL_VERSION_UNSUPPORTED"
            ? "PROTOCOL_VERSION_UNSUPPORTED"
            : "TICKET_ERROR",
        );
      }
      if (
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        Object.keys(payload).length !== 1 ||
        !("ticket" in payload)
      ) {
        throw new TicketRequestError();
      }
      const parsed = gameServerTicketSchema.safeParse(
        (payload as { readonly ticket?: unknown }).ticket,
      );
      if (!parsed.success) {
        throw new TicketRequestError();
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof TicketRequestError) {
        throw error;
      }
      throw new TicketRequestError();
    }
  };
}
