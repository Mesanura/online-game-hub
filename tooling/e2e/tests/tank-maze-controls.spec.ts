import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

function publicView(count = 2, width = 600000, height = 500000) {
  return {
    tick: 180,
    selfSlotId: "p0",
    config: { playerCount: count, targetScore: 5 },
    arena: {
      width,
      height,
      walls: [
        { x: 0, y: 0, w: width, h: 8000 },
        { x: 0, y: height - 8000, w: width, h: 8000 },
        { x: 0, y: 0, w: 8000, h: height },
        { x: width - 8000, y: 0, w: 8000, h: height },
      ],
    },
    tanks: Array.from({ length: count }, (_, i) => ({
      slotId: `p${i}`,
      color: i,
      x: 75000 + (i % 4) * 150000,
      y: 100000 + Math.floor(i / 4) * 250000,
      angle: 0,
      alive: true,
      resigned: false,
      score: 0,
      weapon: "normal",
      ammo: 0,
      shield: 0,
      normalCount: 0,
    })),
    aims: [],
    bullets: [],
    pickups: [],
    phase: "ACTIVE",
    phaseTicks: 0,
    elapsed: 0,
    bout: 1,
    outcome: null,
    events: [],
  };
}

test("eight-player tank touch layout fits phone, tablet and desktop viewports", async ({
  browser,
}, info) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  try {
    const { surface, push } = await openPlaySurface(page, "tank-maze", "1.2.0");
    await push(publicView(8));
    await expect(surface.locator(".score")).toHaveCount(8);
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 780, height: 270 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          surface.locator(".play").evaluate((play) => {
            const box = (name: string) => {
              const button = play.querySelector(`[data-control="${name}"]`);
              if (!button) throw new Error(`Missing ${name} control.`);
              return button.getBoundingClientRect();
            };
            const up = box("up"),
              down = box("down"),
              left = box("left"),
              right = box("right"),
              fire = box("fire");
            const arena = play.querySelector("#arena")?.getBoundingClientRect();
            if (!arena) return false;
            const near = (a: number, b: number) => Math.abs(a - b) < 2;
            return (
              up.bottom <= down.top &&
              near(up.left, down.left) &&
              near(left.top, right.top) &&
              left.right < right.left &&
              fire.bottom <= left.top &&
              near(fire.x + fire.width / 2, (left.x + right.right) / 2) &&
              arena.width > 200 &&
              arena.height > 100 &&
              (innerWidth > innerHeight
                ? up.right <= arena.left && left.left >= arena.right
                : up.top >= arena.bottom &&
                  fire.top >= arena.bottom &&
                  down.right < left.left) &&
              [up, down, left, right, fire].every(
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
          `tank-controls-${viewport.width}x${viewport.height}.png`,
        ),
      });
    }
  } finally {
    await context.close();
  }
});

for (const mode of [
  { version: "1.0.0", width: 390, height: 844 },
  { version: "1.1.0", width: 844, height: 390 },
  { version: "1.2.0", width: 390, height: 844 },
  { version: "1.2.0", width: 844, height: 390 },
]) {
  test(`tank directional sliding, independent inputs and fire edges ${mode.version} ${mode.width}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: mode,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
      await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
      const harness = await openPlaySurface(page, "tank-maze", mode.version);
      const { surface } = harness;
      const view = publicView(
        2,
        mode.version === "1.0.0" ? 800000 : 600000,
        mode.version === "1.2.0" ? 500000 : 600000,
      );
      await harness.push(view);
      await page.clock.runFor(32);
      await expect(surface.locator('[data-control="up"]')).toBeEnabled();
      await surface.locator("#sound").focus();
      const touch = await context.newCDPSession(page);
      type Point = {
        id: number;
        x: number;
        y: number;
        radiusX: number;
        radiusY: number;
        force: number;
      };
      const point = async (control: string, id: number): Promise<Point> => {
        const rect = await surface
          .locator(`[data-control="${control}"]`)
          .boundingBox();
        if (!rect) throw new Error(`Missing ${control} geometry.`);
        return {
          id,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          radiusX: 5,
          radiusY: 5,
          force: 1,
        };
      };
      const dispatch = (
        type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
        points: Point[],
      ) =>
        touch.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      const cancel = () => dispatch("touchCancel", []);
      const expectMove = (move: number, turn: number) =>
        expect
          .poll(async () => (await harness.intents()).at(-1))
          .toEqual({ type: "MOVE", move, turn });
      const fireCount = async () =>
        (await harness.intents()).filter(
          (intent) => (intent as { type: string }).type === "FIRE",
        ).length;
      const held = () => surface.locator('[data-control][aria-pressed="true"]');
      let first = await point("up", 1);
      await dispatch("touchStart", [first]);
      await expectMove(1, 0);
      const beforeSlide = (await harness.intents()).length;
      first = await point("down", 1);
      await dispatch("touchMove", [first]);
      await expectMove(-1, 0);
      expect((await harness.intents()).slice(beforeSlide)).toEqual([
        { type: "MOVE", move: -1, turn: 0 },
      ]);
      await expect(surface.locator('[data-control="up"]')).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(surface.locator('[data-control="down"]')).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const unchanged = (await harness.intents()).length;
      first.x += 2;
      await dispatch("touchMove", [first]);
      expect(await harness.intents()).toHaveLength(unchanged);
      const up = await point("up", 1),
        down = await point("down", 1);
      first = { ...up, y: (up.y + down.y) / 2 };
      await dispatch("touchMove", [first]);
      await expectMove(0, 0);
      await expect(held()).toHaveCount(0);
      first = up;
      await dispatch("touchMove", [first]);
      await expectMove(1, 0);
      let second = await point("left", 2);
      await dispatch("touchStart", [first, second]);
      await expectMove(1, -1);
      second = await point("right", 2);
      await dispatch("touchMove", [first, second]);
      await expectMove(1, 1);
      await expect(surface.locator('[data-control="left"]')).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(held()).toHaveCount(2);
      await page.screenshot({
        path: info.outputPath("tank-held-directions.png"),
      });
      // A nonempty CDP touchEnd list identifies the contacts being lifted.
      await dispatch("touchEnd", [first]);
      await expectMove(0, 1);

      await page.keyboard.down("KeyW");
      await page.keyboard.down("ArrowUp");
      await expectMove(1, 1);
      const third = await point("up", 3),
        fourth = { ...third, id: 4, x: third.x + 8 };
      const beforeDuplicates = (await harness.intents()).length;
      await dispatch("touchStart", [second, third, fourth]);
      await dispatch("touchEnd", [third]);
      await page.keyboard.up("KeyW");
      await page.keyboard.up("ArrowUp");
      expect(await harness.intents()).toHaveLength(beforeDuplicates);
      await dispatch("touchEnd", [fourth]);
      await expectMove(0, 1);
      await cancel();
      await expectMove(0, 0);
      await expect(held()).toHaveCount(0);

      first = await point("up", 1);
      await dispatch("touchStart", [first]);
      await expectMove(1, 0);
      const beforeHeartbeat = (await harness.intents()).length;
      await page.clock.runFor(450);
      await expect
        .poll(async () => (await harness.intents()).length)
        .toBe(beforeHeartbeat + 3);
      await dispatch("touchMove", [await point("fire", 1)]);
      await expectMove(0, 0);
      expect(await fireCount()).toBe(0);
      await cancel();
      const beforeFire = (await harness.intents()).length;
      await dispatch("touchStart", [await point("fire", 5)]);
      await expect.poll(fireCount).toBe(1);
      await page.clock.runFor(600);
      await dispatch("touchMove", [await point("up", 5)]);
      await dispatch("touchEnd", []);
      expect((await harness.intents()).slice(beforeFire)).toEqual([
        { type: "FIRE" },
      ]);
      await dispatch("touchStart", [await point("fire", 5)]);
      await dispatch("touchEnd", []);
      await expect.poll(fireCount).toBe(2);

      const arena = await surface.locator("#arena").boundingBox();
      if (!arena) throw new Error("Missing arena geometry.");
      const beforeOutside = (await harness.intents()).length;
      await dispatch("touchStart", [
        {
          ...up,
          id: 6,
          x: arena.x + arena.width / 2,
          y: arena.y + arena.height / 2,
        },
      ]);
      await dispatch("touchMove", [await point("up", 6)]);
      await cancel();
      expect(await harness.intents()).toHaveLength(beforeOutside);

      let roundNumber = 1;
      for (const reset of [
        "blur",
        "disconnect",
        "bout",
        "round",
        "read-only",
      ]) {
        await surface.locator("#sound").focus();
        await dispatch("touchStart", [await point("up", 1)]);
        await expectMove(1, 0);
        if (reset === "blur") {
          await page.evaluate(() => {
            document.body.tabIndex = -1;
            document.body.focus();
          });
        } else if (reset === "disconnect") {
          await harness.push(view, {
            connectionState: "reconnecting",
            roundNumber,
          });
          await expect(surface.locator('[data-control="up"]')).toBeDisabled();
        } else if (reset === "bout") {
          view.bout++;
          view.tick++;
          view.phase = "PREPARE";
          view.phaseTicks = 180;
          await harness.push(view, { roundNumber });
          await expect(surface.locator('[data-control="up"]')).toBeDisabled();
          view.phase = "ACTIVE";
          view.phaseTicks = 0;
        } else if (reset === "round") {
          roundNumber++;
          await harness.push(view, { roundNumber });
        } else {
          await harness.push(view, { readOnly: true, roundNumber });
          await expect(surface.locator('[data-control="up"]')).toBeDisabled();
        }
        await expect(held()).toHaveCount(0);
        await harness.push(view, { roundNumber });
        await expect(surface.locator('[data-control="up"]')).toBeEnabled();
        const afterReset = (await harness.intents()).length;
        await dispatch("touchMove", [await point("down", 1)]);
        await dispatch("touchMove", [await point("up", 1)]);
        await page.clock.runFor(300);
        await expect(held()).toHaveCount(0);
        expect(await harness.intents()).toHaveLength(afterReset);
        await cancel();
      }
      await dispatch("touchStart", [await point("up", 1)]);
      await expectMove(1, 0);
      await harness.dispose();
      await expect(surface.locator("#arena")).toHaveCount(0);
      const afterDispose = (await harness.intents()).length;
      await cancel();
      await page.clock.runFor(300);
      expect(await harness.intents()).toHaveLength(afterDispose);
      await touch.detach();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
