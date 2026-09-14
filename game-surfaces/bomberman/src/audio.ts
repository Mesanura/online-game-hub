import type { Effect } from "./contracts";
export const sounds = {
  place: {
    start: 440,
    end: 260,
    duration: 0.14,
    volume: 0.1,
    wave: "sine",
  },
  explode: {
    start: 120,
    end: 35,
    duration: 0.08,
    volume: 0.1,
    wave: "sawtooth",
  },
  pickup: {
    start: 640,
    end: 1280,
    duration: 0.12,
    volume: 0.09,
    wave: "triangle",
  },
  hit: {
    start: 520,
    end: 180,
    duration: 0.16,
    volume: 0.08,
    wave: "triangle",
  },
  eliminate: {
    start: 420,
    end: 90,
    duration: 0.2,
    volume: 0.1,
    wave: "triangle",
  },
} as const;
export const FLAME_VOLUME = 0.18;
type FlameVoice = {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  stopAt: number;
};
export class BombermanAudio {
  #context: AudioContext | null = null;
  #disposed = false;
  #enabled = true;
  readonly #voices = new Set<OscillatorNode>();
  #flame: FlameVoice | null = null;
  #noise: AudioBuffer | null = null;
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
    if (event.kind === "place")
      voice.frequency.exponentialRampToValueAtTime(1050, now + 0.035);
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
  /** One shared rumble follows authoritative flame lifetime, including chains.
   * The scheduled stop is a watchdog: a stalled connection cannot leave a loop.
   * A restored snapshot may extend an existing voice, but never start old audio. */
  syncFlames(
    flames: readonly { remainingTicks: number }[],
    allowStart: boolean,
  ): void {
    const context = this.#context;
    const remaining = Math.max(
      0,
      ...flames.map((flame) => flame.remainingTicks),
    );
    if (!this.ready || !context || remaining === 0) {
      this.#stopFlames();
      return;
    }
    const now = context.currentTime;
    if (this.#flame && this.#flame.stopAt <= now) this.#stopFlames();
    const starting = this.#flame === null;
    if (!this.#flame) {
      if (!allowStart) return;
      if (!this.#noise) {
        this.#noise = context.createBuffer(
          1,
          Math.round(context.sampleRate / 4),
          context.sampleRate,
        );
        const samples = this.#noise.getChannelData(0);
        let noise = 0x5ab21;
        for (let index = 0; index < samples.length; index += 1) {
          noise ^= noise << 13;
          noise ^= noise >>> 17;
          noise ^= noise << 5;
          samples[index] = (noise >>> 0) / 0x80000000 - 1;
        }
      }
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.#noise;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(850, now);
      filter.Q.setValueAtTime(0.7, now);
      source.connect(filter).connect(gain).connect(context.destination);
      const voice = { source, filter, gain, stopAt: now };
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        if (this.#flame === voice) this.#flame = null;
      };
      this.#flame = voice;
      gain.gain.setValueAtTime(0.0001, now);
      source.start(now);
    }
    const voice = this.#flame;
    const stopAt = now + remaining / 60;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(starting ? 0.0001 : FLAME_VOLUME, now);
    voice.gain.gain.linearRampToValueAtTime(
      FLAME_VOLUME,
      now + Math.min(0.008, remaining / 120),
    );
    voice.gain.gain.setValueAtTime(FLAME_VOLUME, stopAt - 0.004);
    voice.gain.gain.linearRampToValueAtTime(0, stopAt);
    voice.stopAt = stopAt;
    voice.source.stop(stopAt);
  }
  #stopFlames(): void {
    if (!this.#flame) return;
    const voice = this.#flame;
    this.#flame = null;
    try {
      voice.source.stop();
    } catch {
      /* Already ended. */
    }
    voice.source.disconnect();
    voice.filter.disconnect();
    voice.gain.disconnect();
  }
  silence(): void {
    this.#stop();
  }
  #stop(): void {
    this.#stopFlames();
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
    this.#noise = null;
  }
}
