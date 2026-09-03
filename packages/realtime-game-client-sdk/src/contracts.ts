import type { ComponentType } from "react";

export type RealtimeClientConnectionState =
  "idle" | "loading" | "connecting" | "connected" | "reconnecting" | "closed";

export interface RealtimeGameClientProps<View, Input> {
  readonly view: Readonly<View>;
  readonly previousView: Readonly<View> | null;
  readonly serverTick: number;
  readonly acknowledgedInputSequence: number;
  readonly connectionState: RealtimeClientConnectionState;
  readonly reducedMotion: boolean;
  readonly readOnly?: boolean;
  submitInput(input: Input): Promise<void>;
}

export interface RealtimeGameClientModule<View = unknown, Input = unknown> {
  readonly gameId: string;
  readonly gameVersion: string;
  parseView(input: unknown): View;
  readonly createResignInput?: () => Input;
  readonly Component: ComponentType<RealtimeGameClientProps<View, Input>>;
}

export interface UnknownRealtimeGameClientModule {
  readonly gameId: string;
  readonly gameVersion: string;
  parseView(input: unknown): unknown;
  readonly createResignInput?: () => unknown;
  readonly Component: ComponentType<RealtimeGameClientProps<unknown, unknown>>;
}

export function eraseRealtimeGameClientModule<View, Input>(
  module: RealtimeGameClientModule<View, Input>,
): UnknownRealtimeGameClientModule {
  return module as unknown as UnknownRealtimeGameClientModule;
}
