import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

interface PublicView {
  phase: string;
  phaseTicks: number;
  bout?: number;
  remainingTicks: number;
  arena: { cols: number; rows: number; cellSize: number; tiles: string[] };
  players: {
    slotId: string;
    index: number;
    x: number;
    y: number;
    alive: boolean;
    resigned: boolean;
    score?: number;
    lives?: number;
    invulnerableTicks?: number;
  }[];
  roundResult: { winnerSlotId: string | null; reason: string } | null;
  outcome: {
    type: string;
    winnerSlotId: string | null;
    reason: string;
    scores: { slotId: string; score: number }[];
  } | null;
}
async function publicView(version = "1.0.0"): Promise<PublicView> {
  return JSON.parse(
    await readFile(
      new URL(
        "../../../game-surfaces/bomberman/tests/fixtures/play" +
          (version === "1.1.0" ? "-1.1" : "") +
          ".json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as PublicView;
}

for (const version of ["1.0.0", "1.1.0"]) {
  test(`bomberman ${version} renders the complete pixel arena, four player cards and accessible controls across viewports`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const { surface, push } = await openPlaySurface(
        page,
        "bomberman",
        version,
      );
      await push(await publicView(version), { tick: 180 });
      await expect(surface.locator(".score-card")).toHaveCount(4);
      await expect(surface.locator("#match-timer")).toHaveText(
        version === "1.0.0" ? "03:00" : "02:58",
      );
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
        { width: 780, height: 270 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
        { width: 2560, height: 1440 },
      ]) {
        await page.setViewportSize(viewport);
        await surface.locator("#arena-canvas").focus();
        await expect
          .poll(
            () =>
              surface.locator(".play-shell").evaluate((play) => {
                const canvas = play.querySelector<HTMLCanvasElement>(
                  "#arena-canvas canvas",
                );
                const stick = play.querySelector("#joystick");
                const bomb = play.querySelector("#bomb-button");
                const arenaHost = play.querySelector("#arena-canvas");
                const inventory = play.querySelector("#inventory");
                const phase = play.querySelector("#phase-label");
                if (
                  !canvas ||
                  !stick ||
                  !bomb ||
                  !arenaHost ||
                  !inventory ||
                  !phase
                )
                  return false;
                const arena = canvas.getBoundingClientRect();
                const hostRect = arenaHost.getBoundingClientRect();
                const inventoryRect = inventory.getBoundingClientRect();
                const focusStyle = getComputedStyle(arenaHost);
                const focusExtent = Math.max(
                  0,
                  Number.parseFloat(focusStyle.outlineWidth) +
                    Number.parseFloat(focusStyle.outlineOffset),
                );
                const left = stick.getBoundingClientRect(),
                  right = bomb.getBoundingClientRect();
                const fits = (rect: DOMRect) =>
                  rect.left >= 0 &&
                  rect.top >= 0 &&
                  rect.right <= innerWidth + 1 &&
                  rect.bottom <= innerHeight + 1;
                const controlsFit = [left, right].every(
                  (rect) => rect.width >= 44 && rect.height >= 44 && fits(rect),
                );
                return (
                  canvas.width === 416 &&
                  canvas.height === 352 &&
                  Math.abs(arena.width / arena.height - 13 / 11) < 0.01 &&
                  arena.width >= 130 &&
                  arena.height >= 100 &&
                  fits(arena) &&
                  fits(inventoryRect) &&
                  Number.parseFloat(focusStyle.outlineWidth) > 0 &&
                  hostRect.top - focusExtent >=
                    phase.getBoundingClientRect().bottom &&
                  hostRect.bottom + focusExtent <= inventoryRect.top &&
                  controlsFit &&
                  (innerWidth <= 640 && innerHeight > innerWidth
                    ? left.top >= arena.bottom && right.top >= arena.bottom
                    : left.right <= arena.left && right.left >= arena.right) &&
                  document.documentElement.scrollWidth <= innerWidth &&
                  stick.contains(
                    document.elementFromPoint(
                      left.x + left.width / 2,
                      left.y + left.height / 2,
                    ),
                  ) &&
                  bomb.contains(
                    document.elementFromPoint(
                      right.x + right.width / 2,
                      right.y + right.height / 2,
                    ),
                  ) &&
                  getComputedStyle(canvas).imageRendering === "pixelated"
                );
              }),
            {
              message: `Arena and controls fit ${viewport.width}×${viewport.height}`,
            },
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath(
            `bomberman-${viewport.width}x${viewport.height}.png`,
          ),
        });
      }
      const palette = await surface
        .locator("#arena-canvas canvas")
        .evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const data = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (!data) return 0;
          const colors = new Set<string>();
          for (let i = 0; i < data.length; i += 16)
            colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          return colors.size;
        });
      expect(palette).toBeGreaterThan(20);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test(`bomberman ${version} keyboard keeps the last held direction, renews leases and never repeats bombs`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
    const harness = await openPlaySurface(page, "bomberman", version, {
      reducedMotion: false,
    });
    const view = await publicView(version);
    await harness.push(view, { tick: 180 });
    await expect(harness.surface.locator("#arena-canvas")).toBeVisible();
    await harness.surface.locator("#arena-canvas").focus();
    const expectMove = (direction: string) =>
      expect
        .poll(async () => (await harness.intents()).at(-1))
        .toEqual({ type: "MOVE", direction });
    await page.keyboard.down("KeyW");
    await expectMove("up");
    await page.keyboard.down("KeyD");
    await expectMove("right");
    await page.keyboard.down("ArrowUp");
    await expectMove("up");
    await page.keyboard.up("KeyW");
    await expectMove("up");
    await page.keyboard.up("ArrowUp");
    await expectMove("right");
    const beforeHeartbeat = (await harness.intents()).length;
    await page.clock.runFor(500);
    await expect
      .poll(async () => (await harness.intents()).length)
      .toBe(beforeHeartbeat + 3);
    await page.keyboard.up("KeyD");
    await expectMove("none");
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.clock.runFor(600);
    expect(
      (await harness.intents()).filter(
        (entry) => (entry as { type: string }).type === "PLACE_BOMB",
      ),
    ).toHaveLength(1);
    await page.keyboard.up("Space");
    await page.keyboard.press("Space");
    await expect
      .poll(
        async () =>
          (await harness.intents()).filter(
            (entry) => (entry as { type: string }).type === "PLACE_BOMB",
          ).length,
      )
      .toBe(2);
    await page.keyboard.down("KeyA");
    await expectMove("left");
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await expectMove("none");
    await harness.surface.locator("#arena-canvas").focus();
    const released = (await harness.intents()).length;
    await page.clock.runFor(450);
    expect(await harness.intents()).toHaveLength(released);
    await page.keyboard.up("KeyA");
    await page.keyboard.down("KeyS");
    await expectMove("down");
    await harness.push(view, { tick: 183, connectionState: "reconnecting" });
    await expect(harness.surface.locator("#connection-cover")).toBeVisible();
    await harness.push(view, { tick: 183 });
    await expect(harness.surface.locator("#connection-cover")).toBeHidden();
    const reconnected = (await harness.intents()).length;
    await page.clock.runFor(450);
    expect(await harness.intents()).toHaveLength(reconnected);
    await page.keyboard.up("KeyS");
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    test(`bomberman ${version} real multitouch joystick and bomb remain independent at ${viewport.width}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ hasTouch: true, viewport });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
        await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
        const harness = await openPlaySurface(page, "bomberman", version);
        const { surface } = harness;
        const view = await publicView(version);
        await harness.push(view, { tick: 180 });
        await expect(surface.locator("#arena-canvas canvas")).toBeVisible();
        await page.clock.runFor(100);
        await expect(surface.locator("#bomb-button")).toBeEnabled();
        await surface.locator("#joystick").focus();
        const cdp = await context.newCDPSession(page);
        type Point = {
          id: number;
          x: number;
          y: number;
          radiusX: number;
          radiusY: number;
          force: number;
        };
        const point = async (
          selector: string,
          id: number,
          dx = 0,
          dy = 0,
        ): Promise<Point> => {
          const rect = await surface.locator(selector).boundingBox();
          if (!rect) throw new Error("Missing touch geometry.");
          return {
            id,
            x: rect.x + rect.width / 2 + dx,
            y: rect.y + rect.height / 2 + dy,
            radiusX: 4,
            radiusY: 4,
            force: 1,
          };
        };
        const dispatch = (
          type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
          touchPoints: Point[],
        ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
        const expectMove = (direction: string) =>
          expect
            .poll(async () => (await harness.intents()).at(-1))
            .toEqual({ type: "MOVE", direction });
        const bombs = async () =>
          (await harness.intents()).filter(
            (entry) => (entry as { type: string }).type === "PLACE_BOMB",
          ).length;
        let first = await point("#joystick", 1, 3, 3);
        await dispatch("touchStart", [first]);
        await expect(surface.locator("#joystick")).toHaveAttribute(
          "data-direction",
          "none",
        );
        first = await point("#joystick", 1, 35, 10);
        await dispatch("touchMove", [first]);
        await expectMove("right");
        const second = await point("#bomb-button", 2);
        await dispatch("touchStart", [first, second]);
        await expect.poll(bombs).toBe(1);
        await page.clock.runFor(470);
        await expectMove("right");
        expect(await bombs()).toBe(1);
        first = await point("#joystick", 1, 8, -35);
        await dispatch("touchMove", [first, second]);
        await expectMove("up");
        await dispatch("touchEnd", [second]);
        await expect(surface.locator("#bomb-button")).toHaveAttribute(
          "data-held",
          "false",
        );
        await expect(surface.locator("#joystick")).toHaveAttribute(
          "data-direction",
          "up",
        );
        // Captured joystick contact crossing the bomb never creates a bomb press.
        first = await point("#bomb-button", 1);
        await dispatch("touchMove", [first]);
        expect(await bombs()).toBe(1);
        await dispatch("touchCancel", []);
        await expectMove("none");
        // A new bomb contact works while the keyboard remains independently held.
        await surface.locator("#joystick").focus();
        await page.keyboard.down("KeyA");
        await expectMove("left");
        first = await point("#joystick", 1, 0, 35);
        await dispatch("touchStart", [first]);
        await expectMove("down");
        await dispatch("touchEnd", []);
        await expectMove("left");
        await page.keyboard.up("KeyA");
        await expectMove("none");
        await dispatch("touchStart", [await point("#bomb-button", 2)]);
        await dispatch("touchEnd", []);
        await expect.poll(bombs).toBe(2);

        let tick = 180,
          roundNumber = 1;
        for (const reset of [
          "blur",
          "disconnect",
          "bout",
          "round",
          "readOnly",
          "death",
        ]) {
          await surface.locator("#joystick").focus();
          first = await point("#joystick", 1, 35);
          await dispatch("touchStart", [first]);
          await expectMove("right");
          if (reset === "blur") {
            await page.evaluate(() => {
              document.body.tabIndex = -1;
              document.body.focus();
            });
          } else if (reset === "disconnect") {
            await harness.push(view, {
              tick,
              roundNumber,
              connectionState: "reconnecting",
            });
            await expect(surface.locator("#bomb-button")).toBeDisabled();
          } else if (reset === "bout") {
            if (version === "1.0.0") view.bout = (view.bout ?? 1) + 1;
            view.phase = "PREPARE";
            view.phaseTicks = 180;
            await harness.push(view, { tick: ++tick, roundNumber });
            await expect(surface.locator("#bomb-button")).toBeDisabled();
            view.phase = "ACTIVE";
            view.phaseTicks = 0;
          } else if (reset === "round") {
            await harness.push(view, {
              tick: ++tick,
              roundNumber: ++roundNumber,
            });
          } else if (reset === "death") {
            required(view.players[0]).alive = false;
            if (version === "1.1.0") {
              required(view.players[0]).lives = 0;
              required(view.players[0]).invulnerableTicks = 0;
            }
            await harness.push(view, { tick: ++tick, roundNumber });
            await expect(surface.locator("#bomb-button")).toBeDisabled();
            required(view.players[0]).alive = true;
            if (version === "1.1.0") required(view.players[0]).lives = 3;
          } else {
            await harness.push(view, { tick, roundNumber, readOnly: true });
            await expect(surface.locator("#bomb-button")).toBeDisabled();
          }
          await expect(surface.locator("#joystick")).toHaveAttribute(
            "data-direction",
            "none",
          );
          await harness.push(view, { tick: ++tick, roundNumber });
          await expect(surface.locator("#bomb-button")).toBeEnabled();
          const cleared = (await harness.intents()).length;
          await dispatch("touchMove", [await point("#joystick", 1, 0, -35)]);
          await page.clock.runFor(450);
          expect(await harness.intents()).toHaveLength(cleared);
          await dispatch("touchCancel", []);
        }
        first = await point("#joystick", 1, 35);
        await dispatch("touchStart", [first]);
        await expectMove("right");
        await harness.dispose();
        await expect(surface.locator("#arena-canvas")).toHaveCount(0);
        const disposed = (await harness.intents()).length;
        await dispatch("touchCancel", []);
        await page.clock.runFor(450);
        expect(await harness.intents()).toHaveLength(disposed);
        await cdp.detach();
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
test("bomberman projected preparation, intermediate draw and terminal summary use exact Bridge metadata", async ({
  page,
}) => {
  const harness = await openPlaySurface(page, "bomberman", "1.0.0");
  const view = await publicView();
  view.phase = "PREPARE";
  view.phaseTicks = 180;
  await harness.push(view, { tick: 0 });
  await expect(harness.surface.locator("#banner-value")).toHaveText("3");
  await expect(harness.surface.locator("#bomb-button")).toBeDisabled();
  view.phaseTicks = 60;
  await harness.push(view, { tick: 120 });
  await expect(harness.surface.locator("#banner-value")).toHaveText("1");
  view.phase = "RESULT";
  view.phaseTicks = 120;
  view.roundResult = { winnerSlotId: null, reason: "TIMEOUT" };
  await harness.push(view, { tick: 11000 });
  await expect(harness.surface.locator("#banner-value")).toHaveText("平局");
  view.phase = "COMPLETE";
  view.phaseTicks = 0;
  required(view.players[0]).score = 3;
  view.outcome = {
    type: "WIN",
    winnerSlotId: "p0",
    reason: "SCORE",
    scores: view.players.map(({ slotId, score }) => ({
      slotId,
      score: required(score),
    })),
  };
  await harness.push(view, { tick: 12000 });
  await expect(harness.surface.locator("#banner-value")).toHaveText("胜利！");
  await expect
    .poll(async () =>
      (await harness.messages()).filter(
        (message) =>
          (message as { type: string }).type === "surface.result-summary",
      ),
    )
    .toEqual([
      expect.objectContaining({
        type: "surface.result-summary",
        stateSequence: 4,
        tone: "win",
      }),
    ]);
  await harness.push({ ...view, hiddenPickups: [] }, { tick: 12001 });
  await expect(harness.surface.getByRole("alert")).toContainText(
    "收到的竞技场数据无效",
  );
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing Bomberman fixture player.");
  return value;
}
