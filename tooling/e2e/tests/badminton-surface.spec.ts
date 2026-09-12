import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
  test(`badminton touch layout and legacy serve visibility ${version}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const { surface, push } = await openPlaySurface(
        page,
        "badminton",
        version,
      );
      const fixture = JSON.parse(
        await readFile(
          new URL(
            `../../../game-surfaces/badminton/tests/fixtures/${version === "1.0.0" ? "play-v1" : "play"}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (version === "1.2.0") fixture.court.netTop = 370_000;
      await push(fixture);
      await expect(surface.locator("#badminton-canvas canvas")).toBeVisible();
      const serve = surface.locator('[data-control="serve"]');
      if (version === "1.0.0") await expect(serve).toBeHidden();
      else await expect(serve).toBeVisible();
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await expect
          .poll(() =>
            surface.locator(".match-shell").evaluate((shell) => {
              const box = (control: string) => {
                const button = shell.querySelector<HTMLElement>(
                  `[data-control="${control}"]`,
                );
                if (!button) throw new Error(`Missing control ${control}.`);
                return button.getBoundingClientRect();
              };
              const jump = box("jump"),
                left = box("left"),
                right = box("right");
              const clear = box("clear"),
                smash = box("smash"),
                drop = box("drop");
              const stage = shell
                .querySelector(".court-stage")
                ?.getBoundingClientRect();
              if (!stage) return false;
              const buttons = [
                ...shell.querySelectorAll<HTMLElement>("[data-control]"),
              ]
                .filter((button) => !button.hidden)
                .map((button) => button.getBoundingClientRect());
              const near = (a: number, b: number) => Math.abs(a - b) < 2;
              return (
                jump.bottom <= left.top &&
                near(left.top, right.top) &&
                near(jump.x + jump.width / 2, (left.x + right.right) / 2) &&
                clear.bottom <= drop.top &&
                near(smash.top, drop.top) &&
                (innerWidth > innerHeight
                  ? right.right <= stage.left + 1 &&
                    smash.left >= stage.right - 1
                  : jump.top >= stage.bottom &&
                    clear.top >= stage.bottom &&
                    right.right < smash.left) &&
                buttons.every(
                  (rect) =>
                    rect.width >= 48 &&
                    rect.height >= 48 &&
                    rect.left >= 0 &&
                    rect.top >= 0 &&
                    rect.right <= innerWidth &&
                    rect.bottom <= innerHeight,
                )
              );
            }),
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath(
            `badminton-${version}-${viewport.width}x${viewport.height}.png`,
          ),
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
