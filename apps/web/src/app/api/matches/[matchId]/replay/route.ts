import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { reconstructReplayFrames } from "@online-game-hub/game-server-runtime";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { reconstructRealtimeReplayFrames } from "@online-game-hub/realtime-game-sdk";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { definePlayerSlotId } from "@online-game-hub/game-sdk";

import { ACCOUNT_SESSION_COOKIE_NAME } from "../../../../../server/account-session";
import { resolveAccountSession } from "../../../../../server/auth-service";
import { clearAuthenticatedCookies } from "../../../../../server/auth-response";
import {
  getUserMatchReplay,
  getUserRealtimeMatchReplay,
} from "../../../../../server/match-history";
import { getWebServerConfig } from "../../../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "cache-control": "no-store, private",
  vary: "Cookie",
} as const;

function response(
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(payload, {
    status,
    headers: { ...PRIVATE_HEADERS, ...headers },
  });
}

export async function GET(
  request: NextRequest,
  context: { readonly params: Promise<{ readonly matchId: string }> },
) {
  let accountToken: string | undefined;
  try {
    const config = getWebServerConfig();
    accountToken = request.cookies.get(ACCOUNT_SESSION_COOKIE_NAME)?.value;
    const account = await resolveAccountSession(config, accountToken);
    if (account === null) {
      const unauthorized = response({ code: "ACCOUNT_SESSION_REQUIRED" }, 401);
      if (accountToken !== undefined)
        clearAuthenticatedCookies(unauthorized, config);
      return unauthorized;
    }

    const { matchId } = await context.params;
    const result = await getUserMatchReplay(config, account.userId, matchId);
    if (result.status === "available") {
      const rebuilt = reconstructReplayFrames(
        result.replay,
        resolveGameDefinition,
        { kind: "player", slotId: definePlayerSlotId(result.playerSlotId) },
      );
      if (
        rebuilt.status !== "rebuilt" ||
        rebuilt.frames.length - 1 !== result.match.finalRevision
      ) {
        return response({ code: "REPLAY_INVALID" }, 422);
      }
      return response({ match: result.match, frames: rebuilt.frames }, 200);
    }

    const realtime = await getUserRealtimeMatchReplay(
      config,
      account.userId,
      matchId,
    );
    if (realtime.status === "not-found" && result.status === "not-found") {
      return response({ code: "MATCH_NOT_FOUND" }, 404);
    }
    if (realtime.status === "unavailable") {
      return response({ code: "REPLAY_UNAVAILABLE" }, 409);
    }
    if (realtime.status === "available") {
      const rebuilt = reconstructRealtimeReplayFrames(
        realtime.replay,
        resolveRealtimeGameDefinition,
        { kind: "player", slotId: realtime.playerSlotId },
      );
      if (
        rebuilt.status !== "rebuilt" ||
        rebuilt.frames.length - 1 !== realtime.match.finalRevision
      ) {
        return response({ code: "REPLAY_INVALID" }, 422);
      }
      return response(
        { runtime: "realtime", match: realtime.match, frames: rebuilt.frames },
        200,
      );
    }
    return response({ code: "REPLAY_UNAVAILABLE" }, 409);
  } catch {
    return response({ code: "REPLAY_UNAVAILABLE" }, 503);
  }
}
