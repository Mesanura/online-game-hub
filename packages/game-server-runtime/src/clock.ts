export interface CancelTimer {
  cancel(): void;
}

export interface RuntimeClock {
  nowMilliseconds(): number;
  setTimeout(callback: () => void, delayMilliseconds: number): CancelTimer;
}

export const systemRuntimeClock: RuntimeClock = {
  nowMilliseconds: () => Date.now(),
  setTimeout(callback, delayMilliseconds) {
    const handle = setTimeout(callback, delayMilliseconds);
    return { cancel: () => clearTimeout(handle) };
  },
};
