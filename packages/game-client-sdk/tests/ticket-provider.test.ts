import { describe, expect, it, vi } from "vitest";
import { SETUP_PROTOCOL_VERSION } from "@online-game-hub/protocol";

import {
  TicketRequestError,
  createHttpTicketProvider,
} from "../src/ticket-provider.js";

describe("HTTP Game Server ticket provider", () => {
  it("preserves the protocol update error without exposing the response body", async () => {
    const provider = createHttpTicketProvider("/api/game-ticket", async () =>
      Response.json(
        { code: "PROTOCOL_VERSION_UNSUPPORTED", details: "private" },
        { status: 400 },
      ),
    );
    await expect(provider()).rejects.toThrow(/^PROTOCOL_VERSION_UNSUPPORTED$/u);
  });

  it("requests a same-origin short-lived ticket without reading session data", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ ticket: "opaque-ticket" }),
    );
    const provider = createHttpTicketProvider(
      "/api/game-ticket",
      fetchImplementation,
    );
    await expect(provider()).resolves.toBe("opaque-ticket");
    expect(fetchImplementation).toHaveBeenCalledWith("/api/game-ticket", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ protocolVersion: 6 }),
    });
  });

  it("requests the exact Setup V6 ticket generation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ ticket: "opaque-v6-ticket" }),
    );
    const provider = createHttpTicketProvider(
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

  it.each([
    Response.json({ ticket: "valid", playerSessionId: "must-not-leak" }),
    Response.json({ playerSessionId: "must-not-leak" }),
    Response.json({ ticket: "" }),
    new Response("internal secret", { status: 500 }),
  ])(
    "rejects invalid responses with a constant safe error",
    async (response) => {
      const provider = createHttpTicketProvider("/api/game-ticket", async () =>
        response.clone(),
      );
      const failure = provider();
      await expect(failure).rejects.toBeInstanceOf(TicketRequestError);
      await expect(failure).rejects.not.toThrow(
        /must-not-leak|internal secret/u,
      );
    },
  );
});
