import type { SoundCue } from "./presentation";

export class BadmintonAudio {
  #context: AudioContext | null = null;
  #noise: AudioBuffer | null = null;
  #enabled = true;
  #disposed = false;
  get enabled(): boolean {
    return this.#enabled;
  }
  get ready(): boolean {
    return this.#enabled && this.#context?.state === "running";
  }
  async unlock(): Promise<void> {
    if (!this.#enabled || this.#disposed) return;
    try {
      this.#context ??= new AudioContext();
      if (this.#context.state === "suspended") await this.#context.resume();
    } catch {
      /* An unavailable audio device must not interrupt gameplay. */
    }
  }
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) void this.#context?.suspend().catch(() => {});
    else void this.unlock();
  }
  play(cue: SoundCue): void {
    const context = this.#context;
    if (!this.ready || context === null || this.#disposed) return;
    if (this.#noise === null) {
      this.#noise = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.14),
        context.sampleRate,
      );
      const data = this.#noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        data[i] = seed / 2147483648;
      }
    }
    const now = context.currentTime;
    const duration = cue.kind === "swing" ? 0.12 : 0.065;
    const source = context.createBufferSource();
    source.buffer = this.#noise;
    const filter = context.createBiquadFilter();
    filter.type = cue.kind === "swing" ? "bandpass" : "highpass";
    filter.frequency.setValueAtTime(cue.kind === "swing" ? 1800 : 2300, now);
    filter.frequency.exponentialRampToValueAtTime(
      cue.kind === "swing" ? 700 : 1200,
      now + duration,
    );
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      cue.kind === "swing" ? 0.09 : cue.smash ? 0.24 : 0.17,
      now + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    if (cue.kind === "hit") {
      const tone = context.createOscillator();
      const toneGain = context.createGain();
      tone.frequency.setValueAtTime(cue.smash ? 1150 : 1500, now);
      tone.frequency.exponentialRampToValueAtTime(480, now + 0.045);
      toneGain.gain.setValueAtTime(0.075, now);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      tone.connect(toneGain).connect(context.destination);
      tone.start(now);
      tone.stop(now + 0.05);
      tone.onended = () => {
        tone.disconnect();
        toneGain.disconnect();
      };
    }
  }
  dispose(): void {
    this.#disposed = true;
    void this.#context?.close().catch(() => {});
    this.#context = null;
    this.#noise = null;
  }
}
