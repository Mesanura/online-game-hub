import type { Impact } from "./contracts";

export class AirHockeyAudio {
  #context: AudioContext | null = null;
  #enabled = true;
  #disposed = false;
  readonly #voices = new Set<OscillatorNode>();
  get enabled(): boolean {
    return this.#enabled;
  }
  get ready(): boolean {
    return (
      this.#enabled && this.#context?.state === "running" && !this.#disposed
    );
  }
  async unlock(): Promise<void> {
    if (!this.#enabled || this.#disposed) return;
    try {
      this.#context ??= new AudioContext();
      if (this.#context.state === "suspended") await this.#context.resume();
    } catch {
      /* Audio availability never blocks the game. */
    }
  }
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) {
      this.#stopVoices();
      void this.#context?.suspend().catch(() => {});
    } else void this.unlock();
  }
  play(event: Pick<Impact, "kind" | "strength">): void {
    const context = this.#context;
    if (!this.ready || context === null) return;
    const strength = Math.max(0, Math.min(1, event.strength / 1000));
    if (event.kind === "GOAL") {
      this.#stopVoices();
      for (const [i, frequency] of [523.25, 659.25, 783.99].entries())
        this.#tone(
          context,
          frequency,
          frequency * 0.98,
          0.14,
          0.07,
          i * 0.085,
          "sine",
        );
    } else if (event.kind === "PADDLE") {
      this.#tone(
        context,
        1050 + strength * 550,
        360,
        0.07,
        0.025 + strength * 0.065,
        0,
        "triangle",
      );
    } else {
      this.#tone(
        context,
        420 + strength * 300,
        180,
        0.055,
        0.015 + strength * 0.045,
        0,
        "sine",
      );
    }
  }
  #tone(
    context: AudioContext,
    start: number,
    end: number,
    duration: number,
    volume: number,
    delay: number,
    type: OscillatorType,
  ): void {
    if (this.#voices.size >= 8) return;
    const tone = context.createOscillator();
    const gain = context.createGain();
    const time = context.currentTime + delay;
    tone.type = type;
    tone.frequency.setValueAtTime(start, time);
    tone.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    tone.connect(gain).connect(context.destination);
    this.#voices.add(tone);
    tone.onended = () => {
      tone.disconnect();
      gain.disconnect();
      this.#voices.delete(tone);
    };
    tone.start(time);
    tone.stop(time + duration + 0.01);
  }
  #stopVoices(): void {
    for (const voice of this.#voices) {
      try {
        voice.stop();
      } catch {
        /* Already-ended voices need no work. */
      }
      voice.disconnect();
    }
    this.#voices.clear();
  }
  dispose(): void {
    this.#disposed = true;
    this.#stopVoices();
    void this.#context?.close().catch(() => {});
    this.#context = null;
  }
}
