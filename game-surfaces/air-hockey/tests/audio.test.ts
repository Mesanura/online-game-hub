import { afterEach, describe, expect, it, vi } from "vitest";
import { AirHockeyAudio } from "../src/audio";

afterEach(() => vi.unstubAllGlobals());
describe("sound feedback lifecycle", () => {
  it("unlocks on interaction, distinguishes three cues, mutes and disposes", async () => {
    const tones: {
      type: string;
      frequency: {
        setValueAtTime: ReturnType<typeof vi.fn>;
        exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
      };
      stop: ReturnType<typeof vi.fn>;
    }[] = [];
    const started = vi.fn(),
      closed = vi.fn(),
      created = vi.fn();
    const node = () => {
      const value = {
        type: "",
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: started,
        stop: vi.fn(),
        onended: null,
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      };
      value.connect.mockReturnValue(value);
      return value;
    };
    class Context {
      state = "suspended";
      currentTime = 0;
      destination = {};
      constructor() {
        created();
      }
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
      createGain = node;
      createOscillator() {
        const tone = node();
        tones.push(tone);
        return tone;
      }
    }
    vi.stubGlobal("AudioContext", Context);
    const audio = new AirHockeyAudio();
    audio.play({ kind: "PADDLE", strength: 1000 });
    expect(started).not.toHaveBeenCalled();
    await audio.unlock();
    expect(audio.ready).toBe(true);
    audio.play({ kind: "PADDLE", strength: 1000 });
    expect(tones[0]?.type).toBe("triangle");
    expect(tones[0]?.frequency.setValueAtTime).toHaveBeenCalledWith(1600, 0);
    audio.play({ kind: "WALL", strength: 0 });
    expect(tones[1]?.type).toBe("sine");
    expect(tones[1]?.frequency.setValueAtTime).toHaveBeenCalledWith(420, 0);
    audio.play({ kind: "GOAL", strength: 1000 });
    expect(started).toHaveBeenCalledTimes(5);
    expect(tones[0]?.stop).toHaveBeenCalledTimes(2);
    audio.setEnabled(false);
    audio.play({ kind: "WALL", strength: 1000 });
    expect(started).toHaveBeenCalledTimes(5);
    expect(audio.ready).toBe(false);
    audio.setEnabled(true);
    await audio.unlock();
    expect(created).toHaveBeenCalledOnce();
    audio.play({ kind: "WALL", strength: 1000 });
    expect(started).toHaveBeenCalledTimes(6);
    audio.dispose();
    await audio.unlock();
    expect(closed).toHaveBeenCalledOnce();
    expect(created).toHaveBeenCalledOnce();
    expect(audio.ready).toBe(false);
  });
  it("continues when Web Audio is unavailable", async () => {
    vi.stubGlobal("AudioContext", function Unavailable() {
      throw new Error("unavailable");
    });
    const audio = new AirHockeyAudio();
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.ready).toBe(false);
    expect(() => audio.play({ kind: "GOAL", strength: 1000 })).not.toThrow();
  });
});
