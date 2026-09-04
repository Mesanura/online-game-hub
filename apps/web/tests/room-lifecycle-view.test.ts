import { describe, expect, it } from "vitest";

import {
  roomLifecycleStateSchema,
  roomLifecycleStateV6Schema,
} from "@online-game-hub/protocol";

import { normalizeRoomLifecycle } from "../src/components/game-room-host";

describe("normalizeRoomLifecycle", () => {
  it("preserves the legacy V5 lifecycle shape", () => {
    const lifecycle = roomLifecycleStateSchema.parse({
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

    expect(normalizeRoomLifecycle(lifecycle)).toBe(lifecycle);
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
          occupied: true,
          online: true,
          ready: true,
        },
        {
          slotId: "slot-guest",
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
        starter: "RANDOM",
        selfReady: true,
        readyPlayerCount: 1,
        requiredPlayerCount: 2,
        setupRevision: 3,
        canReady: true,
      },
      players: [
        { slotId: "slot-owner", assignment: null },
        { slotId: "slot-guest", assignment: null },
      ],
    });
  });

  it("does not expose FIXED as a legacy starter selection", () => {
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

    expect(normalizeRoomLifecycle(lifecycle)?.nextRound?.starter).toBeNull();
  });
});
