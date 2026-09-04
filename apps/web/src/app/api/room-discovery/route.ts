import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  roomDiscoveryQuerySchema,
  roomDiscoverySchema,
} from "@online-game-hub/protocol";

import { getWebServerConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store, private" } as const;

export async function GET(request: NextRequest) {
  const searchEntries = [...request.nextUrl.searchParams.entries()];
  const parsedQuery = roomDiscoveryQuerySchema.safeParse(
    Object.fromEntries(searchEntries),
  );
  if (!parsedQuery.success || searchEntries.length !== 2) {
    return NextResponse.json(
      { code: "INVALID_ROOM_DISCOVERY_REQUEST" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    const config = getWebServerConfig();
    const query = new URLSearchParams(parsedQuery.data);
    const response = await fetch(
      `${config.gameServerPublicUrl}/room-discovery?${query.toString()}`,
      {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
    if (!response.ok) {
      return NextResponse.json(
        {
          code:
            response.status === 404
              ? "ROOM_NOT_FOUND"
              : "ROOM_DISCOVERY_UNAVAILABLE",
        },
        {
          status: response.status === 404 ? 404 : 503,
          headers: noStoreHeaders,
        },
      );
    }
    const discovery = roomDiscoverySchema.safeParse(
      (await response.json()) as unknown,
    );
    if (
      !discovery.success ||
      discovery.data.gameId !== parsedQuery.data.gameId ||
      discovery.data.roomCode !== parsedQuery.data.roomCode
    ) {
      return NextResponse.json(
        { code: "ROOM_DISCOVERY_UNAVAILABLE" },
        { status: 503, headers: noStoreHeaders },
      );
    }
    return NextResponse.json(discovery.data, {
      status: 200,
      headers: noStoreHeaders,
    });
  } catch {
    return NextResponse.json(
      { code: "ROOM_DISCOVERY_UNAVAILABLE" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
