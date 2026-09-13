import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

function publicView() {
  return {
    tick: 180,
    selfSlotId: "p0",
    config: { playerCount: 2, targetScore: 5 },
    arena: {
      width: 600000,
      height: 500000,
      walls: [
        { x: 0, y: 0, w: 600000, h: 8000 },
        { x: 0, y: 492000, w: 600000, h: 8000 },
        { x: 0, y: 0, w: 8000, h: 500000 },
        { x: 592000, y: 0, w: 8000, h: 500000 },
      ],
    },
    tanks: [0, 1].map((i) => ({
      slotId: `p${i}`,
      color: i,
      x: 300000 + i * 150000,
      y: i === 0 ? 27000 : 350000,
      angle: 450,
      alive: true,
      resigned: false,
      score: 0,
      weapon: "normal",
      ammo: 0,
      shield: 600,
      shieldRadius: 36000,
      wallContact: false,
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

for (const mode of [
  { name: "desktop", width: 1280, height: 800, reduced: false },
  { name: "portrait", width: 390, height: 844, reduced: false },
  { name: "landscape", width: 844, height: 390, reduced: false },
  { name: "reduced", width: 1280, height: 800, reduced: true },
]) {
  test.describe(mode.name, () => {
    test.use({
      viewport: { width: mode.width, height: mode.height },
      hasTouch: mode.name === "portrait" || mode.name === "landscape",
    });
    test("renders wall alignment, bounded smoke and a shield covering the muzzle", async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const time = Date.UTC(2026, 8, 13, 12);
      await page.clock.install({ time });
      await page.clock.pauseAt(time + 1000);
      const { surface, push, dispose } = await openPlaySurface(
        page,
        "tank-maze",
        "1.3.0",
        { reducedMotion: mode.reduced },
      );
      const view = publicView();
      const self = view.tanks[0];
      if (!self) throw new Error("Missing public tank.");
      const cloud = surface.locator("[data-wall-smoke] circle");
      const body = surface.locator('[data-tank="0"]');
      await push(view);
      await page.clock.runFor(32);
      await expect(cloud).toHaveCount(0);
      await expect(body.locator("[data-shield]")).toHaveAttribute("r", "36");
      const geometry = await body.evaluate((node) => {
        const shield = node.querySelector<SVGCircleElement>("[data-shield]");
        const muzzle = node
          .querySelector<SVGRectElement>('rect[width="24"]')
          ?.getBBox();
        if (!shield || !muzzle)
          throw new Error("Missing shield/muzzle geometry.");
        return {
          radius: shield.r.baseVal.value,
          muzzleRadius: Math.hypot(
            muzzle.x + muzzle.width,
            muzzle.y + muzzle.height,
          ),
        };
      });
      expect(geometry.radius - geometry.muzzleRadius).toBeGreaterThan(6);
      self.wallContact = true;
      for (let frame = 0; frame < 10; frame++) {
        view.tick += 3;
        self.x -= 5500;
        self.angle -= 9;
        await push(view);
        await page.clock.runFor(50);
      }
      // Render a frame beyond the final snapshot's 50ms interpolation window.
      await page.clock.runFor(32);
      await expect(body.locator(":scope > g")).toHaveAttribute(
        "transform",
        "rotate(180)",
      );
      if (mode.reduced) await expect(cloud).toHaveCount(0);
      else expect(await cloud.count()).toBeGreaterThan(2);
      await page.screenshot({
        path: info.outputPath(`tank-wall-${mode.name}.png`),
      });
      const count = await cloud.count();
      await push(view);
      await page.clock.runFor(16);
      await expect(cloud).toHaveCount(count);

      self.wallContact = false;
      view.tick += 3;
      await push(view);
      await page.clock.runFor(750);
      await expect(cloud).toHaveCount(0);

      self.wallContact = true;
      view.tick += 3;
      await push(view);
      await page.clock.runFor(32);
      if (!mode.reduced) expect(await cloud.count()).toBeGreaterThan(0);
      await push(view, { connectionState: "reconnecting" });
      await page.clock.runFor(32);
      await expect(cloud).toHaveCount(0);
      view.tick += 60;
      await push(view);
      await page.clock.runFor(32);
      await expect(cloud).toHaveCount(0);
      view.tick += 3;
      await push(view);
      await page.clock.runFor(32);
      if (!mode.reduced) expect(await cloud.count()).toBeGreaterThan(0);
      await push(view, { readOnly: true });
      await page.clock.runFor(32);
      await expect(cloud).toHaveCount(0);

      view.bout++;
      view.tick += 3;
      view.phase = "PREPARE";
      view.phaseTicks = 180;
      await push(view);
      await page.clock.runFor(32);
      await expect(cloud).toHaveCount(0);
      await expect(surface.locator("#countdown")).toHaveText("3");
      await dispose();
      await expect(surface.locator("#arena")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}

for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
  test(`preserves the historical shield radius for ${version}`, async ({
    page,
  }) => {
    const { surface, push } = await openPlaySurface(page, "tank-maze", version);
    const view = publicView();
    await push({
      ...view,
      tanks: view.tanks.map((tank) => {
        const { shieldRadius, wallContact, ...legacy } = tank;
        void shieldRadius;
        void wallContact;
        return legacy;
      }),
    });
    await expect(
      surface.locator('[data-tank="0"] [data-shield]'),
    ).toHaveAttribute("r", "30");
    await expect(surface.locator("[data-wall-smoke]")).toHaveCount(0);
  });
}
