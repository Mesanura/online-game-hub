import type { ComponentType } from "react";

export type ClientConnectionState =
  "idle" | "loading" | "connecting" | "connected" | "reconnecting" | "closed";

export interface GameClientProps<View, Action> {
  readonly view: Readonly<View>;
  readonly revision: number;
  readonly connectionState: ClientConnectionState;
  /** Prevents all game controls from submitting actions in replay mode. */
  readonly readOnly?: boolean;
  submitAction(action: Action): Promise<void>;
}

export interface GameClientModule<View = unknown, Action = unknown> {
  readonly gameId: string;
  readonly gameVersion: string;
  parseView(input: unknown): View;
  readonly createResignAction?: () => Action;
  readonly Component: ComponentType<GameClientProps<View, Action>>;
}

export interface UnknownGameClientModule {
  readonly gameId: string;
  readonly gameVersion: string;
  parseView(input: unknown): unknown;
  readonly createResignAction?: () => unknown;
  readonly Component: ComponentType<GameClientProps<unknown, unknown>>;
}

export function eraseGameClientModule<View, Action>(
  module: GameClientModule<View, Action>,
): UnknownGameClientModule {
  return module as unknown as UnknownGameClientModule;
}
