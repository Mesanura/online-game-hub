import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) {
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
      if (version === "1.2.0" || version === "1.3.0")
        fixture.court.netTop = 370_000;
      await push(fixture);
      await expect(surface.locator("#badminton-canvas canvas")).toBeVisible();
      await expect(
        surface.getByRole("button", { name: "起跳", exact: true }),
      ).toHaveText("↑W");
      const serve = surface.locator('[data-control="serve"]');
      if (version === "1.0.0") await expect(serve).toBeHidden();
      else await expect(serve).toBeVisible();
      if (version === "1.3.0") {
        await expect(surface.getByTestId("tactics-help")).toContainText(
          "朝网打短 / 离网打深",
        );
        await expect(surface.locator("#control-help")).toContainText(
          "等球落到身前高点",
        );
      } else await expect(surface.getByTestId("tactics-help")).toHaveCount(0);
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(
          surface.locator('[data-control="jump"] kbd'),
        ).toBeVisible();
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

test("badminton 1.3.0 keeps smash placement available to keyboard and real multitouch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 844, height: 390 },
  });
  const page = await context.newPage();
  try {
    const { surface, push, intents } = await openPlaySurface(
      page,
      "badminton",
      "1.3.0",
    );
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../game-surfaces/badminton/tests/fixtures/play.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    fixture.court.netTop = 370_000;
    await push(fixture);
    await expect(surface.locator('[data-control="serve"]')).toBeEnabled();
    await expect(surface.locator('[data-control="smash"]')).toBeDisabled();
    await push({ ...fixture, phase: "RALLY", tick: 1 });
    await expect(surface.locator('[data-control="smash"]')).toBeEnabled();
    await surface.locator("#badminton-canvas").click();
    const expected = {
      type: "CONTROL",
      move: 0,
      jump: false,
      serve: false,
      shot: "SMASH",
    };
    await page.keyboard.down("KeyK");
    await page.keyboard.down("KeyD");
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ ...expected, move: 1 });
    await page.keyboard.up("KeyD");
    await expect.poll(async () => (await intents()).at(-1)).toEqual(expected);
    await page.keyboard.down("KeyA");
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ ...expected, move: -1 });
    await page.keyboard.up("KeyA");
    await page.keyboard.up("KeyK");
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ ...expected, shot: "NONE" });

    const touch = await context.newCDPSession(page);
    const points = await Promise.all(
      ["left", "jump", "smash"].map(async (control, index) => {
        const box = await surface
          .locator(`[data-control="${control}"]`)
          .boundingBox();
        if (box === null) throw new Error(`Missing ${control} button.`);
        return {
          id: index + 1,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          radiusX: 6,
          radiusY: 6,
          force: 1,
        };
      }),
    );
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points,
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ ...expected, move: -1, jump: true });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ ...expected, shot: "NONE" });
    await expect(
      surface.locator('[data-control][aria-pressed="true"]'),
    ).toHaveCount(0);
    await touch.detach();
  } finally {
    await context.close();
  }
});
