import { expect, it, vi } from "vitest";
import { NinjaAudio } from "../src/audio";
import { soundPresets, type SoundKind } from "../src/sounds";
function harness() {
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const gains: {
    gain: ReturnType<typeof parameter>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const sources: {
    buffer: AudioBuffer | null;
    loop: boolean;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const context = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    decodeAudioData: vi.fn(
      async (data: ArrayBuffer) =>
        ({ duration: data.byteLength > 0 ? 1 : 0 }) as AudioBuffer,
    ),
    createGain: () => {
      const gain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain);
      return gain;
    },
    createDynamicsCompressor: () => ({
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createStereoPanner: () => ({
      pan: parameter(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createBufferSource: () => {
      const source = {
        buffer: null as AudioBuffer | null,
        loop: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      source.stop.mockImplementation(() => source.onended?.());
      sources.push(source);
      return source;
    },
  };
  let now = 0;
  const audio = new NinjaAudio(
    () => context as unknown as AudioContext,
    () => now,
  );
  return {
    audio,
    context,
    sources,
    gains,
    setNow: (value: number) => {
      now = value;
    },
  };
}
it("decodes supplied WAVs after a gesture, caches them, and plays all six short cues", async () => {
  const { audio, context, sources } = harness();
  audio.play("ATTACK");
  expect(sources).toHaveLength(0);
  await audio.unlock();
  expect(context.decodeAudioData).toHaveBeenCalledTimes(6);
  for (const [bytes] of context.decodeAudioData.mock.calls)
    expect(bytes.byteLength).toBeGreaterThan(2000);
  for (const kind of Object.keys(soundPresets) as SoundKind[]) audio.play(kind);
  expect(sources).toHaveLength(6);
  expect(
    sources.every(
      (s) => s.start.mock.calls[0]?.[2] <= 0.38 && s.loop === false,
    ),
  ).toBe(true);
  await audio.unlock();
  expect(context.decodeAudioData).toHaveBeenCalledTimes(6);
  expect(soundPresets.CLASH.gain).toBeGreaterThan(soundPresets.ATTACK.gain * 3);
});
it("prioritizes clashes, stops all voices on mute and releases the context on dispose", async () => {
  const { audio, sources, context } = harness();
  await audio.unlock();
  audio.play("ATTACK");
  audio.play("CLASH");
  expect(sources[0]?.stop).toHaveBeenCalled();
  await audio.toggle();
  expect(sources[1]?.stop).toHaveBeenCalled();
  audio.play("DEATH");
  expect(sources).toHaveLength(2);
  await audio.toggle();
  audio.play("DEATH");
  expect(sources).toHaveLength(3);
  audio.dispose();
  expect(context.close).toHaveBeenCalled();
  audio.play("JUMP");
  expect(sources).toHaveLength(3);
});
it("does not play pending decode results after losing focus", async () => {
  const { audio, context, sources } = harness();
  const pending: ((value: AudioBuffer) => void)[] = [];
  context.decodeAudioData.mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const unlocking = audio.unlock();
  audio.play("CLASH");
  audio.silence();
  for (const resolve of pending) resolve({ duration: 1 } as AudioBuffer);
  await unlocking;
  await Promise.resolve();
  expect(sources).toHaveLength(0);
});
it("handles decode failure without breaking gameplay", async () => {
  const { audio, context, sources, setNow } = harness();
  context.decodeAudioData.mockRejectedValueOnce(new Error("decode"));
  await audio.unlock();
  expect(audio.failed).toBe(true);
  await audio.unlock();
  expect(audio.failed).toBe(false);
  audio.silence();
  setNow(500);
  audio.play("JUMP");
  expect(sources).toHaveLength(1);
});
it("drops cues when decoding finishes after their freshness window", async () => {
  const { audio, context, sources, setNow } = harness();
  const pending: ((value: AudioBuffer) => void)[] = [];
  context.decodeAudioData.mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const unlocking = audio.unlock();
  audio.play("CLASH");
  setNow(201);
  for (const resolve of pending) resolve({ duration: 1 } as AudioBuffer);
  await unlocking;
  await Promise.resolve();
  expect(sources).toHaveLength(0);
});
