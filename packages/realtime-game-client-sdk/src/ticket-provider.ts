import { gameServerTicketSchema } from "@online-game-hub/protocol";

/** A browser-side provider for short-lived Game Server tickets. */
export type RealtimeTicketProvider = () => Promise<string>;

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
  return async () => {
    try {
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
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
