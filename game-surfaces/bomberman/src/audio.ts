import type { Effect } from "./contracts";
export const sounds = {
  place: {
    start: 360,
    end: 170,
    duration: 0.07,
    volume: 0.025,
    wave: "square",
  },
  explode: {
    start: 120,
    end: 35,
    duration: 0.26,
    volume: 0.045,
    wave: "sawtooth",
  },
  pickup: {
    start: 640,
    end: 1280,
    duration: 0.12,
    volume: 0.035,
    wave: "triangle",
  },
  eliminate: {
    start: 420,
    end: 90,
    duration: 0.2,
    volume: 0.025,
    wave: "triangle",
  },
} as const;
export class BombermanAudio {
  #context: AudioContext | null = null;
  #disposed = false;
  #enabled = true;
  readonly #voices = new Set<OscillatorNode>();
  constructor(
    private readonly createContext: () => AudioContext = () =>
      new AudioContext(),
  ) {}
  get enabled(): boolean {
    return this.#enabled;
  }
  get ready(): boolean {
    return (
      this.#enabled && !this.#disposed && this.#context?.state === "running"
    );
  }
  async unlock(): Promise<void> {
    if (this.#disposed || !this.#enabled) return;
    try {
      this.#context ??= this.createContext();
      if (this.#context.state === "suspended") await this.#context.resume();
    } catch {
      /* Unsupported or denied audio does not interrupt play. */
    }
  }
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) {
      this.#stop();
      void this.#context?.suspend().catch(() => {});
    } else void this.unlock();
  }
  play(event: Pick<Effect, "kind">): void {
    const context = this.#context;
    if (!this.ready || context === null || this.#voices.size >= 8) return;
    const sound = sounds[event.kind];
    const voice = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    voice.type = sound.wave;
    voice.frequency.setValueAtTime(sound.start, now);
    voice.frequency.exponentialRampToValueAtTime(
      sound.end,
      now + sound.duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(sound.volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.duration);
    voice.connect(gain).connect(context.destination);
    this.#voices.add(voice);
    voice.onended = () => {
      voice.disconnect();
      gain.disconnect();
      this.#voices.delete(voice);
    };
    voice.start(now);
    voice.stop(now + sound.duration + 0.01);
  }
  #stop(): void {
    for (const voice of this.#voices) {
      try {
        voice.stop();
      } catch {
        /* Already stopped. */
      }
      voice.disconnect();
    }
    this.#voices.clear();
  }
  dispose(): void {
    this.#disposed = true;
    this.#stop();
    void this.#context?.close().catch(() => {});
    this.#context = null;
  }
}
