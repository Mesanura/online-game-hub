import { afterEach, describe, expect, it, vi } from "vitest";
import { BadmintonAudio } from "../src/audio";

afterEach(() => vi.unstubAllGlobals());
describe("audio lifecycle", () => {
  it("gates sound on user unlock, supports mute and releases its context", async () => {
    const started = vi.fn(),
      closed = vi.fn();
    const parameter = () => ({
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });
    const node = () => {
      const value = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: started,
        stop: vi.fn(),
        gain: parameter(),
        frequency: parameter(),
      };
      value.connect.mockReturnValue(value);
      return value;
    };
    class Context {
      state = "suspended";
      sampleRate = 8000;
      currentTime = 0;
      destination = {};
      async resume() {
        this.state = "running";
      }
      async suspend() {
        this.state = "suspended";
      }
      async close() {
        closed();
        this.state = "closed";
      }
      createBuffer() {
        return { getChannelData: () => new Float32Array(1120) };
      }
      createBufferSource = node;
      createBiquadFilter = node;
      createGain = node;
      createOscillator = node;
    }
    vi.stubGlobal("AudioContext", Context);
    const audio = new BadmintonAudio();
    const cue = { kind: "hit", tick: 1, smash: false } as const;
    audio.play(cue);
    expect(started).not.toHaveBeenCalled();
    await audio.unlock();
    expect(audio.ready).toBe(true);
    audio.play(cue);
    expect(started).toHaveBeenCalledTimes(2);
    audio.setEnabled(false);
    audio.play(cue);
    expect(started).toHaveBeenCalledTimes(2);
    audio.setEnabled(true);
    await audio.unlock();
    audio.play({ kind: "swing", tick: 2, smash: false });
    expect(started).toHaveBeenCalledTimes(3);
    audio.dispose();
    expect(closed).toHaveBeenCalledOnce();
    expect(audio.ready).toBe(false);
  });
  it("does not fail gameplay when the browser has no available audio context", async () => {
    vi.stubGlobal("AudioContext", function UnavailableAudioContext() {
      throw new Error("Audio unavailable");
    });
    const audio = new BadmintonAudio();
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.ready).toBe(false);
  });
});
