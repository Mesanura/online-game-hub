import { expect, test, type Locator } from "@playwright/test";

import { openPlaySurface } from "../src/play-surface.js";

const fixture = {
  field: { width: 800_000, height: 400_000 },
  players: [
    { slotId: "left", side: "LEFT" },
    { slotId: "right", side: "RIGHT" },
  ],
  paddles: [
    { y: 200_000, height: 80_000 },
    { y: 200_000, height: 80_000 },
  ],
  ball: { x: 400_000, y: 200_000, radius: 8_000 },
  scores: [0, 0],
  tick: 0,
  targetScore: 3,
  yourSide: "LEFT",
  outcome: null,
};

async function touchPoint(button: Locator, id: number) {
  const box = await button.boundingBox();
  if (box === null) throw new Error("Missing Pong direction button.");
  return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
  test(`Pong touch layout, combined input and release lifecycle ${version}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const { surface, push, intents, dispose } = await openPlaySurface(
        page,
        "pong",
        version,
      );
      const view = version === "1.0.0" ? fixture : { ...fixture, serve: null };
      await push(view);
      const canvas = surface.locator("#pong-canvas");
      const up = surface.getByRole("button", { name: "挡板向上" });
      const down = surface.getByRole("button", { name: "挡板向下" });
      await expect(canvas.locator("canvas")).toBeVisible();
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 390, height: 844 },
        { width: 568, height: 320 },
        { width: 844, height: 390 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await canvas.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
        );
        await expect
          .poll(() =>
            surface.locator(".pong-shell").evaluate((shell) => {
              const rect = (selector: string) => {
                const element = shell.querySelector(selector);
                if (element === null) throw new Error(`Missing ${selector}.`);
                return element.getBoundingClientRect();
              };
              const up = rect(".pong-up");
              const down = rect(".pong-down");
              const stage = rect(".pong-stage");
              const host = rect("#pong-canvas");
              const canvas = rect("#pong-canvas canvas");
              return (
                [up, down].every(
                  (button) =>
                    button.width >= 64 &&
                    button.height >= 64 &&
                    button.left >= 0 &&
                    button.top >= 0 &&
                    button.right <= innerWidth &&
                    button.bottom <= innerHeight - 48,
                ) &&
                up.right < down.left &&
                (innerWidth > innerHeight
                  ? up.right <= stage.left && down.left >= stage.right
                  : up.top >= stage.bottom && down.top >= stage.bottom) &&
                canvas.width > 0 &&
                Math.abs(canvas.width - host.width) < 1 &&
                Math.abs(canvas.height - host.height) < 1 &&
                Math.abs(canvas.width / canvas.height - 2) < 0.01 &&
                canvas.left >= stage.left + 7 &&
                canvas.top >= stage.top + 7 &&
                canvas.right <= stage.right - 7 &&
                canvas.bottom <= stage.bottom - 7
              );
            }),
          )
          .toBe(true);
        if (
          version === "1.2.0" &&
          (viewport.width === 390 || viewport.width === 844)
        ) {
          await page.screenshot({
            path: info.outputPath(
              `pong-${viewport.width}x${viewport.height}.png`,
            ),
          });
        }
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await canvas.click();
      const touch = await context.newCDPSession(page);
      const upPoint = await touchPoint(up, 1);
      const downPoint = await touchPoint(down, 2);
      const expectDirection = async (direction: -1 | 0 | 1) => {
        await expect
          .poll(async () => (await intents()).at(-1))
          .toEqual({ type: "DIRECTION", direction });
      };

      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [upPoint],
      });
      await expectDirection(-1);
      await page.keyboard.down("KeyW");
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(up).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.up("KeyW");
      await expectDirection(0);

      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [upPoint],
      });
      await expectDirection(-1);
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [upPoint, downPoint],
      });
      await expectDirection(0);
      await expect(up).toHaveAttribute("aria-pressed", "false");
      await expect(down).toHaveAttribute("aria-pressed", "false");
      // CDP lists the contact being lifted, leaving the other finger held.
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [upPoint],
      });
      await expectDirection(1);
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...downPoint, x: 195, y: 300 }],
      });
      await expect(down).toHaveAttribute("aria-pressed", "true");
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await expectDirection(0);

      await up.focus();
      await page.keyboard.down("Space");
      await expectDirection(-1);
      await page.keyboard.up("Space");
      await expectDirection(0);
      await page.keyboard.down("ArrowDown");
      await expectDirection(1);
      await canvas.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expectDirection(0);
      await page.keyboard.up("ArrowDown");

      for (const state of [
        { connectionState: "reconnecting" as const },
        { readOnly: true },
        { roundNumber: 2 },
      ]) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [upPoint],
        });
        await expectDirection(-1);
        await push(view, state);
        await expect(up).toHaveAttribute("aria-pressed", "false");
        if (!("roundNumber" in state)) {
          await expect(up).toBeDisabled();
          await expect(down).toBeDisabled();
        }
        await push(view);
        await expect(up).toBeEnabled();
        await expectDirection(0);
        const count = (await intents()).length;
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [upPoint],
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await expect(up).toHaveAttribute("aria-pressed", "false");
        expect(await intents()).toHaveLength(count);
      }

      await touch.detach();
      await dispose();
      await expect(surface.getByText("游戏画面已关闭。")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
