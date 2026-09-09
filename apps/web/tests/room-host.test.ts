import { describe, expect, it, vi } from "vitest";

import { RuntimeAwareHost } from "../src/components/game-room-host";

describe("RuntimeAwareHost", () => {
  it.each(["turn-based", "realtime"] as const)(
    "keeps %s state updates working after effect cleanup and resubscription",
    async (runtime) => {
      const host = new RuntimeAwareHost({
        runtime,
        gameServerUrl: "http://127.0.0.1:2567",
      });
      const listener = vi.fn();
      const unsubscribe = host.subscribe(listener);
      unsubscribe();
      await host.close();

      const resubscribe = host.subscribe(listener);
      await host.leaveRoom();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(host.getState().connectionState).toBe("idle");
      await host.close();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(host.getState().connectionState).toBe("closed");
      resubscribe();
    },
  );
});
