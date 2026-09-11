import { SETUP_PROTOCOL_VERSION } from "@online-game-hub/protocol";
import { describe, expect, it, vi } from "vitest";

import { createRealtimeHttpTicketProvider } from "../src/ticket-provider.js";

describe("Realtime HTTP Game Server ticket provider", () => {
  it("preserves the protocol update error without exposing the response body", async () => {
    const provider = createRealtimeHttpTicketProvider(
      "/api/game-ticket",
      async () =>
        Response.json(
          { code: "PROTOCOL_VERSION_UNSUPPORTED", details: "private" },
          { status: 400 },
        ),
    );
    await expect(provider()).rejects.toThrow(/^PROTOCOL_VERSION_UNSUPPORTED$/u);
  });

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
