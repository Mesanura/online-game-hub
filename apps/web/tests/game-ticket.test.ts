import { afterEach, describe, expect, it, vi } from "vitest";

import { requestGameTicket } from "../src/lib/game-ticket";
import { GUEST_PROFILE_STORAGE_KEY } from "../src/lib/profile";

afterEach(() => vi.unstubAllGlobals());

describe("Web profile ticket provider", () => {
  it("reports an unsupported protocol as a page update error", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ code: "PROTOCOL_VERSION_UNSUPPORTED" }, { status: 400 }),
    );
    await expect(requestGameTicket()).rejects.toThrow(
      /^PROTOCOL_VERSION_UNSUPPORTED$/u,
    );
  });

  it("reads the latest guest name for each V6 ticket", async () => {
    let displayName = "👩‍💻玩家";
    const getItem = vi.fn(() => JSON.stringify({ displayName }));
    vi.stubGlobal("window", { localStorage: { getItem } });
    const fetcher = vi.fn(async () =>
      Response.json({ ticket: "opaque-ticket" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(requestGameTicket(6)).resolves.toBe("opaque-ticket");
    expect(getItem).toHaveBeenCalledWith(GUEST_PROFILE_STORAGE_KEY);
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/game-ticket",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ protocolVersion: 6, displayName }),
      }),
    );
    displayName = "新名字";
    await requestGameTicket(6);
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/game-ticket",
      expect.objectContaining({
        body: JSON.stringify({ protocolVersion: 6, displayName }),
      }),
    );
  });

  it("can join with default guest metadata when browser storage is blocked", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("blocked");
        },
      },
    });
    const fetcher = vi.fn(async () =>
      Response.json({ ticket: "opaque-ticket" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(requestGameTicket(6)).resolves.toBe("opaque-ticket");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/game-ticket",
      expect.objectContaining({
        body: JSON.stringify({ protocolVersion: 6, displayName: "游客" }),
      }),
    );
  });
});
