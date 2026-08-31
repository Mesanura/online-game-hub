import { describe, expect, expectTypeOf, it } from "vitest";

import {
  RNG_ALGORITHM_V1,
  createRng,
  defineGameId,
  defineGameVersion,
  definePlayerSlotId,
  isJsonValue,
  nextInt,
} from "../src/index.js";
import type {
  GameDefinition,
  GameId,
  GameManifest,
  GameVersion,
  JsonValue,
  PlayerSlotId,
} from "../src/index.js";

describe("semantic identifiers", () => {
  it("brands valid stable identifiers", () => {
    expectTypeOf(defineGameId("tic-tac-toe")).toEqualTypeOf<GameId>();
    expectTypeOf(defineGameVersion("1.0.0")).toEqualTypeOf<GameVersion>();
    expectTypeOf(definePlayerSlotId("player-1")).toEqualTypeOf<PlayerSlotId>();
  });

  it.each(["TicTacToe", "tic_tac_toe", "-tic-tac-toe", "tic--tac"])(
    "rejects invalid game id %s",
    (value) => {
      expect(() => defineGameId(value)).toThrow(TypeError);
    },
  );

  it.each(["1", "v1.0.0", "1.0", "01.0.0", "^1.0.0"])(
    "rejects non-exact semver %s",
    (value) => {
      expect(() => defineGameVersion(value)).toThrow(TypeError);
    },
  );
});

describe("JSON value semantics", () => {
  it("accepts nested JSON and rejects non-JSON values", () => {
    const json: JsonValue = {
      array: [null, true, 1, "value", { nested: false }],
    };
    expect(isJsonValue(json)).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(new Date(0))).toBe(false);
    expect(isJsonValue(new Map())).toBe(false);
    expect(isJsonValue({ missing: undefined })).toBe(false);
  });

  it("rejects cyclic objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isJsonValue(cyclic)).toBe(false);
  });
});

describe("deterministic RNG", () => {
  it("is pure and repeats the same seeded sequence", () => {
    const initial = Object.freeze(createRng("m2-seed"));

    const sample = (): { values: number[]; cursor: number } => {
      let rng = initial;
      const values: number[] = [];
      for (let index = 0; index < 8; index += 1) {
        const step = nextInt(rng, 10);
        values.push(step.value);
        rng = step.next;
      }
      return { values, cursor: rng.cursor };
    };

    expect(sample()).toEqual({
      values: [1, 5, 9, 7, 6, 1, 7, 0],
      cursor: 8,
    });
    expect(sample()).toEqual(sample());
    expect(initial).toEqual({
      algorithm: RNG_ALGORITHM_V1,
      seed: "m2-seed",
      cursor: 0,
    });
  });

  it("validates ranges without advancing its input", () => {
    const initial = createRng("range-seed");
    expect(() => nextInt(initial, 0)).toThrow(RangeError);
    expect(() => nextInt(initial, 1.5)).toThrow(RangeError);
    expect(initial.cursor).toBe(0);
  });
});

it("exports the generic game definition contract", () => {
  expectTypeOf<
    GameDefinition<JsonValue, JsonValue, JsonValue, JsonValue, JsonValue>
  >().toBeObject();
  expectTypeOf<GameManifest["defaultConfig"]>().toEqualTypeOf<JsonValue>();
});
