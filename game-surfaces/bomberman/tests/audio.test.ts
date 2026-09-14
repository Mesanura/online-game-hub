import { describe, expect, it, vi } from "vitest";
import { BombermanAudio, FLAME_VOLUME, sounds } from "../src/audio";
function fakeAudio() {
  const voices: {
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const param = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const context = {
    state: "suspended",
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    suspend: vi.fn(async () => {
      context.state = "suspended";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    createGain: vi.fn(() => ({
      gain: param(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createOscillator: vi.fn(() => {
      const voice = {
        type: "sine",
        frequency: param(),
        connect: vi.fn((gain: unknown) => gain),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null as (() => void) | null,
      };
      voices.push(voice);
      return voice;
    }),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    createBiquadFilter: vi.fn(() => ({
      type: "lowpass",
      frequency: param(),
      Q: param(),
      connect: vi.fn((destination: unknown) => destination),
      disconnect: vi.fn(),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      loop: false,
      connect: vi.fn((destination: unknown) => destination),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      onended: null as (() => void) | null,
    })),
  };
  const factory = vi.fn(() => context as unknown as AudioContext);
  return { context, voices, factory, audio: new BombermanAudio(factory) };
}
describe("bounded local audio", () => {
  it("waits for user unlock, caps voices, mutes immediately and disposes permanently", async () => {
    const { audio, factory, context, voices } = fakeAudio();
    audio.play({ kind: "place" });
    expect(context.createOscillator).not.toHaveBeenCalled();
    await audio.unlock();
    expect(audio.ready).toBe(true);
    for (let i = 0; i < 12; i += 1) audio.play({ kind: "explode" });
    expect(context.createOscillator).toHaveBeenCalledTimes(8);
    voices[0]?.onended?.();
    audio.play({ kind: "pickup" });
    expect(context.createOscillator).toHaveBeenCalledTimes(9);
    audio.setEnabled(false);
    expect(audio.ready).toBe(false);
    expect(voices.every((voice) => voice.stop.mock.calls.length > 0)).toBe(
      true,
    );
    audio.play({ kind: "place" });
    expect(context.createOscillator).toHaveBeenCalledTimes(9);
    audio.setEnabled(true);
    await audio.unlock();
    expect(audio.ready).toBe(true);
    audio.dispose();
    await audio.unlock();
    expect(audio.ready).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledOnce();
  });
  it("does not turn unavailable audio into a game failure", async () => {
    const audio = new BombermanAudio(() => {
      throw new Error("Unavailable");
    });
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.ready).toBe(false);
    expect(() => audio.play({ kind: "place" })).not.toThrow();
    for (const sound of Object.values(sounds)) {
      expect(sound.duration).toBeLessThan(0.3);
      expect(sound.volume).toBeLessThanOrEqual(0.1);
    }
  });
  it("uses an audible sine bubble with a rising then falling pitch for each placement", async () => {
    const { audio, context } = fakeAudio();
    await audio.unlock();
    audio.play({ kind: "place" });
    const voice = context.createOscillator.mock.results[0]?.value;
    expect(voice?.type).toBe("sine");
    expect(voice?.frequency.exponentialRampToValueAtTime.mock.calls).toEqual([
      [1050, 0.035],
      [260, 0.14],
    ]);
    expect(
      context.createGain.mock.results[0]?.value.gain
        .exponentialRampToValueAtTime,
    ).toHaveBeenCalledWith(0.1, 0.006);
    expect(
      FLAME_VOLUME +
        8 * Math.max(...Object.values(sounds).map((sound) => sound.volume)),
    ).toBeLessThan(1);
  });
  it("keeps one rumble through overlapping flames and ends it at the authoritative deadline", async () => {
    const { audio, context } = fakeAudio();
    audio.syncFlames([{ remainingTicks: 30 }], true);
    expect(context.createBufferSource).not.toHaveBeenCalled();
    await audio.unlock();
    audio.syncFlames([{ remainingTicks: 30 }], false);
    expect(context.createBufferSource).not.toHaveBeenCalled();
    audio.syncFlames([{ remainingTicks: 30 }], true);
    const loop = context.createBufferSource.mock.results[0]?.value;
    expect(loop?.loop).toBe(true);
    expect(loop?.stop).toHaveBeenLastCalledWith(0.5);
    context.currentTime = 0.25;
    audio.syncFlames([{ remainingTicks: 15 }, { remainingTicks: 30 }], true);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(loop?.stop).toHaveBeenLastCalledWith(0.75);
    context.currentTime = 0.75;
    loop?.onended?.();
    audio.syncFlames([], false);
    expect(loop?.disconnect).toHaveBeenCalled();
    audio.syncFlames([{ remainingTicks: 20 }], false);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
  });
  it.each(["silence", "mute", "dispose"])(
    "immediately cancels sustained fire on %s and never replays a restored flame",
    async (action) => {
      const { audio, context } = fakeAudio();
      await audio.unlock();
      audio.syncFlames([{ remainingTicks: 30 }], true);
      const loop = context.createBufferSource.mock.results[0]?.value;
      if (action === "silence") audio.silence();
      else if (action === "mute") audio.setEnabled(false);
      else audio.dispose();
      expect(loop?.stop).toHaveBeenLastCalledWith();
      expect(loop?.disconnect).toHaveBeenCalled();
      audio.syncFlames([{ remainingTicks: 20 }], false);
      expect(context.createBufferSource).toHaveBeenCalledOnce();
    },
  );
});
