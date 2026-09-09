import { describe, expect, it } from "vitest";

import {
  normalizePlayerDisplayName,
  playerDisplayNameSchema,
  roomLifecycleStateSchema,
  roomLifecycleStateV6Schema,
  roomProfileCommandSchema,
} from "../src/index.js";

describe("public room profile extension", () => {
  it("normalizes user input and requires canonical, bounded text on the wire", () => {
    expect(normalizePlayerDisplayName(" e\u0301 ")).toBe("é");
    expect(playerDisplayNameSchema.safeParse(" e\u0301 ").success).toBe(false);
    expect(playerDisplayNameSchema.safeParse("👩‍💻".repeat(24)).success).toBe(
      true,
    );
    for (const value of [
      "",
      " ",
      "a\nname",
      "a".repeat(25),
      "a" + "\u0301".repeat(512),
    ]) {
      expect(playerDisplayNameSchema.safeParse(value).success).toBe(false);
    }
  });

  it.each([5, 6] as const)(
    "keeps V%i legacy payloads valid and rejects private profile fields",
    (protocolVersion) => {
      const schema =
        protocolVersion === 5
          ? roomLifecycleStateSchema
          : roomLifecycleStateV6Schema;
      const player = {
        slotId: "slot-1",
        occupied: true,
        online: true,
        ready: false,
        ...(protocolVersion === 5 ? { assignment: null } : {}),
      };
      const lifecycle = {
        type: "room.lifecycle",
        protocolVersion,
        isOwner: true,
        currentRound: { roundNumber: 1, status: "active" },
        nextRound: null,
        closed: false,
        closeReason: null,
        players: [player],
      };
      expect(schema.parse(lifecycle).players?.[0]).not.toHaveProperty(
        "displayName",
      );
      expect(
        schema.parse({
          ...lifecycle,
          players: [{ ...player, displayName: "👩‍💻玩家" }],
        }).players?.[0]?.displayName,
      ).toBe("👩‍💻玩家");
      expect(
        schema.safeParse({
          ...lifecycle,
          players: [{ ...player, displayName: "" }],
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...lifecycle,
          players: [{ ...player, displayName: "玩家", userId: "private-id" }],
        }).success,
      ).toBe(false);
      const update = {
        type: "room.profile",
        protocolVersion,
        commandId: "profile-1",
        ticket: "signed-ticket",
      };
      expect(roomProfileCommandSchema.parse(update)).toEqual(update);
      for (const extra of [
        { slotId: "forged" },
        { displayName: "forged" },
        { userId: "forged" },
      ]) {
        expect(
          roomProfileCommandSchema.safeParse({ ...update, ...extra }).success,
        ).toBe(false);
      }
    },
  );
});
