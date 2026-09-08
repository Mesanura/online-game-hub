export class TankAudio {
  private context: AudioContext | null = null;
  private last = 0;
  muted = false;
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
  }
  play(kind: "fire" | "bounce" | "hit" | "pickup") {
    const c = this.context;
    if (
      c === null ||
      this.muted ||
      c.state !== "running" ||
      c.currentTime - this.last < 0.025
    )
      return;
    this.last = c.currentTime;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = kind === "hit" ? "sawtooth" : "triangle";
    o.frequency.setValueAtTime(
      { fire: 260, bounce: 470, hit: 90, pickup: 650 }[kind],
      c.currentTime,
    );
    o.frequency.exponentialRampToValueAtTime(
      kind === "pickup" ? 1100 : 45,
      c.currentTime + 0.12,
    );
    g.gain.setValueAtTime(0.055, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.15);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  close() {
    void this.context?.close();
    this.context = null;
  }
}
