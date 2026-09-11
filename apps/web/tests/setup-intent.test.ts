import { describe, expect, it } from "vitest";
import { CommandRejectedError } from "@online-game-hub/game-client-sdk";
import { RealtimeControlRejectedError } from "@online-game-hub/realtime-game-client-sdk";
import type { CommandRejectedV6 } from "@online-game-hub/protocol";

import { submitSetupIntent } from "../src/lib/setup-intent";

describe("Setup intent feedback", () => {
  it("accepts only after the command promise is acknowledged", async () => {
    let acknowledge: (() => void) | undefined;
    let finished = false;
    const command = submitSetupIntent(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    ).then((result) => {
      finished = true;
      return result;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    acknowledge?.();
    await expect(command).resolves.toEqual({ status: "accepted" });
  });

  for (const ErrorType of [
    CommandRejectedError,
    RealtimeControlRejectedError,
  ]) {
    it.each([
      ["STALE_SETUP_REVISION", undefined, "stale", "STALE_SETUP_REVISION"],
      ["SETUP_RULE_REJECTED", "NOT_OWNER", "rejected", "NOT_OWNER"],
      ["SETUP_RULE_REJECTED", "CAMP_TAKEN", "rejected", "CAMP_TAKEN"],
      ["SETUP_RULE_REJECTED", "COLOR_TAKEN", "rejected", "COLOR_TAKEN"],
      ["SETUP_RULE_REJECTED", undefined, "rejected", "SETUP_RULE_REJECTED"],
      ["INVALID_SETUP_PAYLOAD", undefined, "rejected", "INVALID_SETUP_PAYLOAD"],
    ] as const)(
      `${ErrorType.name} forwards %s / %s without the rejection envelope`,
      async (code, gameRuleCode, status, surfaceCode) => {
        const rejection: CommandRejectedV6 = {
          type: "command.rejected",
          protocolVersion: 6,
          commandId: "private-command-id",
          setupRevision: 7,
          code,
          retryable: false,
          ...(gameRuleCode === undefined ? {} : { gameRuleCode }),
        };
        await expect(
          submitSetupIntent(() => Promise.reject(new ErrorType(rejection))),
        ).resolves.toEqual({ status, code: surfaceCode });
      },
    );
  }

  it.each([
    new Error("private transport diagnostics"),
    { rejection: { code: "STALE_SETUP_REVISION" } },
    null,
  ])(
    "does not interpret unknown failures or expose their contents",
    async (error) => {
      await expect(
        submitSetupIntent(() => Promise.reject(error)),
      ).resolves.toEqual({
        status: "rejected",
        code: "HOST_REJECTED",
      });
    },
  );
});
