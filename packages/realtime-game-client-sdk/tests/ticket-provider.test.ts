import { SETUP_PROTOCOL_VERSION } from "@online-game-hub/protocol";
import { describe, expect, it, vi } from "vitest";

import { createRealtimeHttpTicketProvider } from "../src/ticket-provider.js";

describe("Realtime HTTP Game Server ticket provider", () => {
  it("requests a ticket for the exact setup protocol generation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ ticket: "opaque-v6-ticket" }),
    );
    const provider = createRealtimeHttpTicketProvider(
      "/api/game-ticket",
      fetchImplementation,
    );

    await expect(provider(SETUP_PROTOCOL_VERSION)).resolves.toBe(
      "opaque-v6-ticket",
    );
    expect(fetchImplementation).toHaveBeenCalledWith("/api/game-ticket", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ protocolVersion: SETUP_PROTOCOL_VERSION }),
    });
  });
});
