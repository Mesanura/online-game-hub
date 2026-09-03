export interface RealtimeSnapshotSample<View> {
  readonly tick: number;
  readonly view: Readonly<View>;
}

export interface RealtimeSnapshotPair<View> {
  readonly previous: RealtimeSnapshotSample<View> | null;
  readonly current: RealtimeSnapshotSample<View>;
}

/** Keeps only monotonic authoritative snapshots; interpolation remains visual-only. */
export class RealtimeSnapshotBuffer<View> {
  #pair: RealtimeSnapshotPair<View> | null = null;

  public get value(): RealtimeSnapshotPair<View> | null {
    return this.#pair;
  }

  public push(sample: RealtimeSnapshotSample<View>): boolean {
    if (!Number.isSafeInteger(sample.tick) || sample.tick < 0) {
      throw new RangeError(
        "Realtime snapshot tick must be a non-negative integer.",
      );
    }
    const current = this.#pair?.current;
    if (current !== undefined && sample.tick < current.tick) return false;
    if (current !== undefined && sample.tick === current.tick) {
      this.#pair = { previous: this.#pair?.previous ?? null, current: sample };
      return true;
    }
    this.#pair = { previous: current ?? null, current: sample };
    return true;
  }

  public clear(): void {
    this.#pair = null;
  }
}

export function interpolationAlpha(
  elapsedMilliseconds: number,
  tickRate = 60,
): number {
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0)
    return 0;
  if (!Number.isFinite(tickRate) || tickRate <= 0) return 1;
  return Math.min(1, elapsedMilliseconds / (1000 / tickRate));
}
