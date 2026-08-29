import type { ComponentType } from "react";

export type ClientConnectionState =
  "loading" | "connecting" | "connected" | "reconnecting" | "closed";

export interface GameClientProps<View, Action> {
  readonly view: Readonly<View>;
  readonly revision: number;
  readonly connectionState: ClientConnectionState;
  submitAction(action: Action): Promise<void>;
}

export interface GameClientModule<View = unknown, Action = unknown> {
  readonly gameId: string;
  readonly gameVersion: string;
  parseView(input: unknown): View;
  readonly Component: ComponentType<GameClientProps<View, Action>>;
}

export interface UnknownGameClientModule {
  readonly gameId: string;
  readonly gameVersion: string;
  parseView(input: unknown): unknown;
  readonly Component: ComponentType<GameClientProps<unknown, unknown>>;
}

export function eraseGameClientModule<View, Action>(
  module: GameClientModule<View, Action>,
): UnknownGameClientModule {
  return module as unknown as UnknownGameClientModule;
}
