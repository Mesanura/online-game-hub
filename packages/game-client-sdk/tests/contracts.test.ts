import { describe, expect, expectTypeOf, it } from "vitest";

import {
  eraseGameClientModule,
  type GameClientModule,
} from "../src/contracts.js";

interface TestView {
  readonly value: string;
}

type TestAction =
  | { readonly type: "PLAY" }
  | { readonly type: "RESIGN" };

describe("game client module contracts", () => {
  it("preserves an optional typed resignation action factory when erased", () => {
    const module = {
      gameId: "test-game",
      gameVersion: "1.0.0",
      parseView: (): TestView => ({ value: "visible" }),
      createResignAction: (): TestAction => ({ type: "RESIGN" }),
      Component: () => null,
    } satisfies GameClientModule<TestView, TestAction>;

    expectTypeOf(module.createResignAction).returns.toEqualTypeOf<TestAction>();

    const erased = eraseGameClientModule(module);

    expect(erased.createResignAction?.()).toEqual({ type: "RESIGN" });
    expectTypeOf(erased.createResignAction).toEqualTypeOf<
      (() => unknown) | undefined
    >();
  });

  it("keeps modules without resignation support compatible", () => {
    const module = {
      gameId: "test-game",
      gameVersion: "1.0.0",
      parseView: (): TestView => ({ value: "visible" }),
      Component: () => null,
    } satisfies GameClientModule<TestView, TestAction>;

    expect(eraseGameClientModule(module).createResignAction).toBeUndefined();
  });
});
