import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const origin = "http://tank-surface.test";
const modes = [
  {
    name: "desktop",
    width: 1280,
    height: 800,
    reduced: false,
    version: "1.1.0",
  },
  { name: "mobile", width: 390, height: 844, reduced: false, version: "1.1.0" },
  {
    name: "landscape",
    width: 844,
    height: 390,
    reduced: false,
    version: "1.1.0",
  },
  {
    name: "reduced",
    width: 1280,
    height: 800,
    reduced: true,
    version: "1.0.0",
  },
];

for (const mode of modes) {
  test.describe(mode.name, () => {
    test.use({
      viewport: { width: mode.width, height: mode.height },
      hasTouch: mode.name === "mobile" || mode.name === "landscape",
      contextOptions: {
        reducedMotion: mode.reduced ? "reduce" : "no-preference",
      },
    });
    test(`tank Surface centers pickups and handles hit feedback (${mode.name})`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(`${origin}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/") {
          await route.fulfill({
            contentType: "text/html",
            body: '<style>body{margin:0}iframe{width:100%;height:100dvh;border:0;display:block}</style><iframe sandbox="allow-scripts" src="/play/index.html"></iframe>',
          });
          return;
        }
        if (path !== "/play/index.html" && !/^\/assets\/[\w.-]+$/.test(path)) {
          await route.fulfill({ status: 404 });
          return;
        }
        await route.fulfill({
          contentType: path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : "text/html",
          body: await readFile(
            new URL(
              `../../../game-surfaces/tank-maze/dist${path}`,
              import.meta.url,
            ),
          ),
        });
      });
      await page.goto(origin);
      const surface = page.frameLocator("iframe");
      await expect(surface.locator(".loading")).toBeVisible();
      await page.evaluate(async ({ reduced, version }) => {
        const frame = document.querySelector("iframe");
        if (!frame?.contentWindow) throw new Error("Surface frame missing");
        const channel = new MessageChannel();
        Object.assign(window, {
          tankTestPort: channel.port1,
          tankTestSequence: 0,
        });
        await new Promise<void>((resolve) => {
          channel.port1.onmessage = (event) => {
            if (event.data.type !== "surface.ready") return;
            channel.port1.postMessage({
              type: "host.init",
              bridgeVersion: 2,
              gameId: "tank-maze",
              gameVersion: version,
              mode: "play",
              locale: "zh-CN",
              reducedMotion: reduced,
            });
            resolve();
          };
          frame.contentWindow?.postMessage(
            {
              type: "host.hello",
              bridgeVersion: 2,
              mode: "play",
              nonce: "tank-surface-viewport-test-000000000000",
            },
            "*",
            [channel.port2],
          );
        });
      }, mode);
      const view = {
        tick: 0,
        selfSlotId: "p0",
        config: { playerCount: 2, targetScore: 5 },
        arena: {
          width: 600000,
          height: 600000,
          walls: [
            { x: 0, y: 0, w: 600000, h: 8000 },
            { x: 0, y: 592000, w: 600000, h: 8000 },
            { x: 0, y: 0, w: 8000, h: 600000 },
            { x: 592000, y: 0, w: 8000, h: 600000 },
            { x: 196000, y: 296000, w: 208000, h: 8000 },
          ],
        },
        tanks: [0, 1].map((i) => ({
          slotId: `p${i}`,
          color: i,
          x: 150000 + i * 300000,
          y: 450000,
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
        pickups: ["laser", "missile", "machine"].map((kind, i) => ({
          id: i + 1,
          kind,
          x: 100000 + i * 100000,
          y: 200000,
          life: 1200,
        })),
        phase: "PREPARE",
        phaseTicks: 180,
        elapsed: 0,
        bout: 1,
        outcome: null,
        events: [] as { id: number; kind: string; x: number; y: number }[],
      };
      const push = () =>
        page.evaluate((payload) => {
          const host = window as typeof window & {
            tankTestPort: MessagePort;
            tankTestSequence: number;
          };
          host.tankTestPort.postMessage({
            type: "host.state",
            sequence: ++host.tankTestSequence,
            connectionState: "connected",
            readOnly: false,
            roundNumber: 1,
            payload,
          });
        }, view);
      await push();
      await expect(surface.locator("#countdown")).toHaveText("3");
      const arena = surface.locator("#arena");
      await expect(surface.locator("[data-pickup]")).toHaveCount(3);
      await page.screenshot({
        path: info.outputPath(`tank-${mode.name}-countdown.png`),
      });
      for (const remaining of [120, 60]) {
        view.tick += 60;
        view.phaseTicks = remaining;
        await push();
        await expect(surface.locator("#countdown")).toHaveText(
          String(remaining / 60),
        );
      }
      view.tick = 180;
      view.phase = "ACTIVE";
      view.phaseTicks = 0;
      await push();
      await expect(surface.locator("#countdown")).toBeEmpty();
      const checkCenters = async () => {
        const centers = await surface
          .locator("[data-pickup]")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const box = node.querySelector("rect")?.getBBox();
              const symbol = node
                .querySelector<SVGGraphicsElement>("[data-pickup-symbol]")
                ?.getBBox();
              if (!box || !symbol) throw new Error("Pickup geometry missing");
              return {
                x: symbol.x + symbol.width / 2 - box.x - box.width / 2,
                y: symbol.y + symbol.height / 2 - box.y - box.height / 2,
              };
            }),
          );
        for (const center of centers) {
          expect(Math.abs(center.x)).toBeLessThan(0.1);
          expect(Math.abs(center.y)).toBeLessThan(0.1);
        }
      };
      await checkCenters();
      await page.screenshot({
        path: info.outputPath(`tank-${mode.name}-pickups.png`),
      });
      view.tick++;
      view.pickups = ["shotgun", "shield"].map((kind, i) => ({
        id: 4 + i,
        kind,
        x: 250000 + i * 100000,
        y: 200000,
        life: 1200,
      }));
      await push();
      await expect(surface.locator("[data-pickup]")).toHaveCount(2);
      await checkCenters();
      await page.screenshot({
        path: info.outputPath(`tank-${mode.name}-shield-shotgun.png`),
      });
      const animations = await arena.evaluateHandle((element) => {
        const animations: Animation[] = [];
        const animate = element.animate.bind(element);
        element.animate = (keyframes, options) => {
          const animation = animate(keyframes, options);
          animation.pause();
          animations.push(animation);
          return animation;
        };
        return animations;
      });
      const header = await surface.locator("header").boundingBox();
      view.tick++;
      view.events = [{ id: 10, kind: "hit", x: 150000, y: 450000 }];
      view.tanks = view.tanks.map((tank, i) => ({ ...tank, alive: i !== 0 }));
      await push();
      await expect(surface.locator(".explosion")).toHaveCount(1);
      expect(await animations.evaluate((items) => items.length)).toBe(
        mode.reduced ? 0 : 1,
      );
      if (mode.reduced) {
        expect(
          await arena.evaluate((element) => element.getAnimations().length),
        ).toBe(0);
      } else {
        await animations.evaluate((items) => {
          const animation = items[0];
          if (!animation) throw new Error("Hit animation missing.");
          animation.currentTime = 60;
        });
        const transform = await arena.evaluate((element) => {
          const matrix = new DOMMatrix(getComputedStyle(element).transform);
          return { x: matrix.m41, y: matrix.m42 };
        });
        expect(Math.abs(transform.x) + Math.abs(transform.y)).toBeGreaterThan(
          0.1,
        );
        expect(Math.abs(transform.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(transform.y)).toBeLessThanOrEqual(1);
        expect(await surface.locator("header").boundingBox()).toEqual(header);
        await page.screenshot({
          path: info.outputPath(`tank-${mode.name}-hit.png`),
        });
        await arena.evaluate((element) =>
          element.getAnimations().forEach((animation) => animation.play()),
        );
        await expect
          .poll(() =>
            arena.evaluate((element) => element.getAnimations().length),
          )
          .toBe(0);
      }
      await push();
      await arena.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      expect(await animations.evaluate((items) => items.length)).toBe(
        mode.reduced ? 0 : 1,
      );
      expect(
        await arena.evaluate((element) => element.getAnimations().length),
      ).toBe(0);
      view.tick += 3;
      view.bout++;
      view.phase = "PREPARE";
      view.phaseTicks = 180;
      view.events = [];
      view.tanks = view.tanks.map((tank) => ({ ...tank, alive: true }));
      await push();
      await expect(surface.locator("#countdown")).toHaveText("3");
      expect(await animations.evaluate((items) => items.length)).toBe(
        mode.reduced ? 0 : 2,
      );
      await push();
      await arena.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      expect(await animations.evaluate((items) => items.length)).toBe(
        mode.reduced ? 0 : 2,
      );
      await page.evaluate(() => {
        const host = window as typeof window & { tankTestPort: MessagePort };
        host.tankTestPort.postMessage({ type: "host.dispose" });
      });
      await expect(arena).toHaveCount(0);
      expect(
        await animations.evaluate((items) =>
          items.every(
            (animation) =>
              animation.playState === "idle" ||
              animation.playState === "finished",
          ),
        ),
      ).toBe(true);
      await animations.dispose();
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
}
