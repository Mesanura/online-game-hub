import { describe, expect, it, vi } from "vitest";
import { BombermanAudio, sounds } from "../src/audio";
function fakeAudio() {
  const voices: {
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const param = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const context = {
    state: "suspended",
    currentTime: 0,
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
      expect(sound.volume).toBeLessThanOrEqual(0.05);
    }
  });
});
