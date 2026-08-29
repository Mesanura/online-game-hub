import { gameServerTicketSchema } from "@online-game-hub/protocol";

export type GameServerTicketProvider = () => Promise<string>;

export class TicketRequestError extends Error {
  public constructor() {
    super("A new Game Server ticket could not be obtained.");
    this.name = "TicketRequestError";
  }
}

export function createHttpTicketProvider(
  endpoint = "/api/game-ticket",
  fetchImplementation: typeof fetch = globalThis.fetch,
): GameServerTicketProvider {
  return async () => {
    try {
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new TicketRequestError();
      }
      const payload = (await response.json()) as unknown;
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
