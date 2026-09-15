import { soundPresets, type SoundKind } from "./sounds";
type Voice = {
  source: AudioBufferSourceNode;
  kind: SoundKind;
  gain: GainNode;
  panner: StereoPannerNode;
};
export class NinjaAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices: Voice[] = [];
  private buffers = new Map<SoundKind, AudioBuffer>();
  private pending = new Set<SoundKind>();
  private preparing: Promise<void> | null = null;
  private generation = 0;
  private disposed = false;
  muted = false;
  failed = false;
  constructor(
    private readonly createContext: () => AudioContext = () =>
      new AudioContext(),
    private readonly now: () => number = () => performance.now(),
  ) {}
  async toggle() {
    this.muted = !this.muted;
    if (this.muted) this.silence();
    else await this.unlock();
  }
  async unlock() {
    if (this.muted || this.disposed) return;
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.output = this.context.createGain();
        this.output.gain.value = 0.6;
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -10;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 8;
        this.output.connect(this.compressor);
        this.compressor.connect(this.context.destination);
      }
      const context = this.context;
      const resume =
        context.state === "suspended" ? context.resume() : Promise.resolve();
      this.preparing ??= Promise.all(
        (Object.keys(soundPresets) as SoundKind[]).map(async (kind) => {
          if (this.buffers.has(kind)) return;
          const data = soundPresets[kind].data;
          const bytes = Uint8Array.from(
            atob(data.slice(data.indexOf(",") + 1)),
            (c) => c.charCodeAt(0),
          );
          const buffer = await context.decodeAudioData(bytes.buffer);
          if (!this.disposed && this.context === context)
            this.buffers.set(kind, buffer);
        }),
      ).then(() => undefined);
      await Promise.all([resume, this.preparing]);
      this.failed = false;
    } catch {
      this.failed = true;
      this.preparing = null;
      this.pending.clear();
    }
  }
  play(kind: SoundKind, pan = 0) {
    if (this.disposed || this.muted || !this.context) return;
    if (this.buffers.has(kind) && this.context.state === "running") {
      this.start(kind, pan);
      return;
    }
    if (!this.preparing || this.pending.has(kind)) return;
    const generation = this.generation,
      at = this.now();
    this.pending.add(kind);
    void this.preparing
      .then(() => {
        if (generation !== this.generation) return;
        this.pending.delete(kind);
        if (
          this.now() - at <= 200 &&
          !this.muted &&
          !this.disposed &&
          this.context?.state === "running"
        )
          this.start(kind, pan);
      })
      .catch(() => this.pending.delete(kind));
  }
  private start(kind: SoundKind, pan: number) {
    const context = this.context,
      buffer = this.buffers.get(kind);
    if (!context || !buffer || !this.output) return;
    if (kind === "CLASH")
      for (const voice of [...this.voices])
        if (voice.kind === "ATTACK" || voice.kind === "CLASH")
          voice.source.stop();
    if (this.voices.length >= 10) {
      const quiet = this.voices.find(
        (v) => v.kind !== "CLASH" && v.kind !== "DEATH",
      );
      if (quiet) quiet.source.stop();
      else return;
    }
    const source = context.createBufferSource(),
      gain = context.createGain(),
      panner = context.createStereoPanner();
    const preset = soundPresets[kind],
      duration = Math.min(preset.duration, buffer.duration);
    source.buffer = buffer;
    source.loop = false;
    panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
    gain.gain.setValueAtTime(preset.gain, context.currentTime);
    gain.gain.setValueAtTime(
      preset.gain,
      context.currentTime + Math.max(0, duration - 0.04),
    );
    gain.gain.linearRampToValueAtTime(0, context.currentTime + duration);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.output);
    const voice = { source, kind, gain, panner };
    this.voices.push(voice);
    source.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    source.start(context.currentTime, 0, duration);
  }
  silence() {
    this.generation++;
    this.pending.clear();
    for (const voice of [...this.voices]) voice.source.stop();
    this.voices = [];
  }
  dispose() {
    this.silence();
    this.disposed = true;
    this.buffers.clear();
    this.output?.disconnect();
    this.compressor?.disconnect();
    void this.context?.close();
    this.context = null;
  }
}
