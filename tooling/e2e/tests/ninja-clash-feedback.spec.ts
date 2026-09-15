import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

const fixture = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../game-surfaces/ninja-clash/tests/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );

for (const [before, after] of [
  ["before-clash", "clash"],
  ["before-kill", "kill-countdown"],
  ["before-final-kill", "kill-finished"],
] as const) {
  test(`ninja sampled feedback survives ${after} and deduplicates snapshots`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (
        ...args: Parameters<typeof original>
      ) {
        document.documentElement.dataset.audioStarts = String(
          Number(document.documentElement.dataset.audioStarts ?? 0) + 1,
        );
        return original.apply(this, args);
      };
    });
    const { surface, push } = await openPlaySurface(
      page,
      "ninja-clash",
      "1.1.0",
      { reducedMotion: false },
    );
    const baseline = await fixture(before),
      event = await fixture(after);
    await push(baseline, { tick: baseline.tick });
    await expect(surface.locator("#stage canvas")).toBeVisible();
    await surface.locator("#stage").click();
    await push(event, { tick: event.tick });
    await expect(surface.locator("html")).toHaveAttribute(
      "data-audio-starts",
      "1",
    );
    if (after === "clash") {
      await expect(surface.locator("#root")).toHaveAttribute(
        "data-hitstop",
        "6",
      );
      await expect(surface.locator("#own-status")).toHaveText("拼刀！");
    }
    await page.screenshot({ path: info.outputPath(`${after}.png`) });
    await push({ ...event, tick: event.tick + 1 }, { tick: event.tick + 1 });
    await expect(surface.locator("html")).toHaveAttribute(
      "data-audio-starts",
      "1",
    );
    await surface.locator("#sound").click();
    await expect(surface.locator("#sound")).toHaveText("音效关");
    await push(
      {
        ...event,
        tick: event.tick + 2,
        effects: event.effects.map((effect: { id: number }) => ({
          ...effect,
          id: effect.id + 100,
        })),
      },
      { tick: event.tick + 2 },
    );
    await expect(surface.locator("html")).toHaveAttribute(
      "data-audio-starts",
      "1",
    );
    expect(errors).toEqual([]);
  });
}
