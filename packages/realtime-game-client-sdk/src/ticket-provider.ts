import {
  PROTOCOL_VERSION,
  gameServerTicketSchema,
  setupProtocolGenerationSchema,
} from "@online-game-hub/protocol";
import type { SetupProtocolGeneration } from "@online-game-hub/protocol";

/** A browser-side provider for short-lived Game Server tickets. */
export type RealtimeTicketProvider = (
  protocolVersion?: SetupProtocolGeneration,
) => Promise<string>;

export class RealtimeTicketRequestError extends Error {
  public constructor() {
    super("A new Game Server ticket could not be obtained.");
    this.name = "RealtimeTicketRequestError";
  }
}

/**
 * Creates the default same-origin HTTP ticket provider.  Keeping this in the
 * realtime SDK avoids making realtime clients depend on the turn-based client
 * SDK while preserving the existing `/api/game-ticket` contract.
 */
export function createRealtimeHttpTicketProvider(
  endpoint = "/api/game-ticket",
  fetchImplementation: typeof fetch = globalThis.fetch,
): RealtimeTicketProvider {
  return async (protocolVersion = PROTOCOL_VERSION) => {
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
      if (!response.ok) throw new RealtimeTicketRequestError();
      const payload = (await response.json()) as unknown;
      if (
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        Object.keys(payload).length !== 1 ||
        !("ticket" in payload)
      ) {
        throw new RealtimeTicketRequestError();
      }
      const parsed = gameServerTicketSchema.safeParse(
        (payload as { readonly ticket?: unknown }).ticket,
      );
      if (!parsed.success) throw new RealtimeTicketRequestError();
      return parsed.data;
    } catch (error) {
      if (error instanceof RealtimeTicketRequestError) throw error;
      throw new RealtimeTicketRequestError();
    }
  };
}
