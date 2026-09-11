import { CommandRejectedError } from "@online-game-hub/game-client-sdk";
import { RealtimeControlRejectedError } from "@online-game-hub/realtime-game-client-sdk";

interface SetupIntentResult {
  readonly status: "accepted" | "rejected" | "stale";
  readonly code?: string;
}

/** Keep transport metadata inside the Host; the Surface interprets only codes. */
export async function submitSetupIntent(
  submit: () => Promise<void>,
): Promise<SetupIntentResult> {
  try {
    await submit();
    return { status: "accepted" };
  } catch (error) {
    if (
      !(error instanceof CommandRejectedError) &&
      !(error instanceof RealtimeControlRejectedError)
    ) {
      return { status: "rejected", code: "HOST_REJECTED" };
    }
    const rejection = error.rejection;
    if (rejection.code === "STALE_SETUP_REVISION") {
      return { status: "stale", code: rejection.code };
    }
    return {
      status: "rejected",
      code:
        rejection.code === "SETUP_RULE_REJECTED"
          ? (rejection.gameRuleCode ?? rejection.code)
          : rejection.code,
    };
  }
}
