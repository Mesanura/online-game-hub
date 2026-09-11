import { describe, expect, it } from "vitest";

import { roomLifecycleStateV6Schema } from "@online-game-hub/protocol";

import { normalizeRoomLifecycle } from "../src/components/game-room-host";

describe("normalizeRoomLifecycle", () => {
  it("rejects the retired V5 lifecycle shape", () => {
    const lifecycle = roomLifecycleStateV6Schema.safeParse({
      type: "room.lifecycle",
      protocolVersion: 5,
      isOwner: true,
      currentRound: null,
      nextRound: {
        roundNumber: 1,
        starter: "OWNER",
        selfReady: false,
        readyPlayerCount: 0,
        requiredPlayerCount: 2,
      },
      closed: false,
      closeReason: null,
    });

    expect(lifecycle.success).toBe(false);
    expect(normalizeRoomLifecycle(null)).toBeNull();
  });

  it("maps V6 readiness and setup projection to the stable Web view", () => {
    const lifecycle = roomLifecycleStateV6Schema.parse({
      type: "room.lifecycle",
      protocolVersion: 6,
      isOwner: true,
      currentRound: null,
      nextRound: {
        roundNumber: 1,
        setupRevision: 3,
        setupView: {
          starter: "RANDOM",
          participantSlotIds: ["slot-owner", "slot-guest"],
        },
        readiness: {
          canReady: true,
          selfReady: true,
          readySlotIds: ["slot-owner"],
          requiredSlotIds: ["slot-owner", "slot-guest"],
        },
      },
      closed: false,
      closeReason: null,
      players: [
        {
          slotId: "slot-owner",
          displayName: "👩‍💻房主",
          occupied: true,
          online: true,
          ready: true,
        },
        {
          slotId: "slot-guest",
          displayName: "玩家乙",
          occupied: true,
          online: true,
          ready: false,
        },
      ],
    });

    expect(normalizeRoomLifecycle(lifecycle)).toMatchObject({
      protocolVersion: 6,
      nextRound: {
        roundNumber: 1,
        selfReady: true,
        readyPlayerCount: 1,
        requiredPlayerCount: 2,
        setupRevision: 3,
        canReady: true,
        setupView: {
          starter: "RANDOM",
          participantSlotIds: ["slot-owner", "slot-guest"],
        },
      },
      players: [
        { slotId: "slot-owner", displayName: "👩‍💻房主" },
        { slotId: "slot-guest", displayName: "玩家乙" },
      ],
    });
  });

  it("keeps game-specific setup fields opaque to the platform", () => {
    const lifecycle = roomLifecycleStateV6Schema.parse({
      type: "room.lifecycle",
      protocolVersion: 6,
      isOwner: false,
      currentRound: { roundNumber: 1, status: "completed" },
      nextRound: {
        roundNumber: 2,
        setupRevision: 0,
        setupView: {
          starter: "FIXED",
          fixedStarterSlotId: "slot-owner",
        },
        readiness: {
          canReady: true,
          selfReady: false,
          readySlotIds: [],
          requiredSlotIds: ["slot-owner", "slot-guest"],
        },
      },
      closed: false,
      closeReason: null,
      players: [
        {
          slotId: "slot-owner",
          occupied: true,
          online: true,
          ready: false,
        },
        {
          slotId: "slot-guest",
          occupied: true,
          online: true,
          ready: false,
        },
      ],
    });

    const normalized = normalizeRoomLifecycle(lifecycle);
    expect(normalized?.nextRound?.setupView).toEqual({
      starter: "FIXED",
      fixedStarterSlotId: "slot-owner",
    });
    expect(normalized?.nextRound).not.toHaveProperty("starter");
    expect(normalized?.players[0]).not.toHaveProperty("assignment");
  });
});
