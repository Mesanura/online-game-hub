export class NinjaAudio {
  private context: AudioContext | null = null;
  private nodes = new Set<OscillatorNode>();
  muted = true;
  async toggle() {
    this.muted = !this.muted;
    if (this.muted) this.silence();
    else await this.unlock();
  }
  async unlock() {
    if (this.muted) return;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }
  play(kind: string) {
    const c = this.context;
    if (this.muted || !c || c.state !== "running") return;
    const oscillator = c.createOscillator(),
      gain = c.createGain();
    const duration = kind === "CLASH" ? 0.12 : kind === "DEATH" ? 0.18 : 0.07;
    oscillator.type = kind === "CLASH" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(
      kind === "CLASH" ? 1100 : kind === "ATTACK" ? 600 : 160,
      c.currentTime,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "CLASH" ? 350 : 60,
      c.currentTime + duration,
    );
    gain.gain.setValueAtTime(0.065, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(c.destination);
    this.nodes.add(oscillator);
    oscillator.onended = () => {
      this.nodes.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(c.currentTime + duration);
  }
  silence() {
    for (const node of this.nodes) {
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
  }
  dispose() {
    this.silence();
    void this.context?.close();
    this.context = null;
  }
}
