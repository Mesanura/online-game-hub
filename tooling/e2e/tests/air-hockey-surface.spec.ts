import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

const fixture = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../game-surfaces/air-hockey/tests/fixtures/play.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
async function clientPoint(canvas: Locator, x: number, y: number) {
  const rect = await canvas.boundingBox();
  if (rect === null) throw new Error("Missing air hockey canvas.");
  return {
    x: rect.x + ((x + 12) / 624) * rect.width,
    y: rect.y + ((y + 12) / 1044) * rect.height,
  };
}
async function pixel(canvas: Locator, x: number, y: number) {
  return canvas.evaluate(
    (node, point) => {
      const context = (node as HTMLCanvasElement).getContext("2d");
      if (!context) throw new Error("Missing canvas context.");
      return [...context.getImageData(point.x, point.y, 1, 1).data].slice(0, 3);
    },
    { x, y },
  );
}
async function hostCommand(page: Page, message: unknown) {
  await page.evaluate((message) => {
    (
      window as unknown as { playTestPort: MessagePort }
    ).playTestPort.postMessage(message);
  }, message);
}
async function renderedFrame(surface: FrameLocator) {
  await surface
    .locator("#root")
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
}

for (const [version, side] of [
  ["1.0.0", 0],
  ["1.0.0", 1],
  ["1.1.0", 0],
  ["1.1.0", 1],
] as const) {
  test(`air hockey ${version} P${side + 1} keeps its colored half below and fits every viewport`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { surface, push } = await openPlaySurface(
      page,
      "air-hockey",
      version,
    );
    const view = await fixture();
    view.yourSide = side;
    view.paddles = [
      { x: 150000, y: 765000 },
      { x: 450000, y: 255000 },
    ];
    await push(view);
    const canvas = surface.locator("#court-canvas canvas");
    await expect(canvas).toBeVisible();
    await expect(surface.locator("#phase-label")).toContainText(
      side === 0 ? "由你开球" : "等待对方开球",
    );
    await expect(
      surface.locator(side === 0 ? "#blue-label" : "#orange-label"),
    ).toContainText("你");
    await expect
      .poll(() => pixel(canvas, 182, side === 0 ? 777 : 267))
      .toEqual([59, 130, 246]);
    await expect
      .poll(() => pixel(canvas, 482, side === 0 ? 267 : 777))
      .toEqual([245, 158, 11]);
    await expect
      .poll(() => pixel(canvas, 312, 1030))
      .toEqual(side === 0 ? [59, 130, 246] : [245, 158, 11]);
    for (const viewport of [
      { width: 2560, height: 1440 },
      { width: 1707, height: 960 },
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          canvas.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const stage = document
              .querySelector(".court-stage")
              ?.getBoundingClientRect();
            const audio = document
              .querySelector("#audio-toggle")
              ?.getBoundingClientRect();
            return (
              !!stage &&
              !!audio &&
              rect.width > 100 &&
              rect.height > 180 &&
              Math.abs(rect.width / rect.height - 624 / 1044) < 0.002 &&
              rect.left >= -1 &&
              rect.top >= stage.top - 1 &&
              rect.right <= innerWidth + 1 &&
              rect.bottom <= stage.bottom + 1 &&
              audio.width >= 44 &&
              audio.height >= 44 &&
              audio.right <= innerWidth &&
              document.documentElement.scrollWidth <= innerWidth
            );
          }),
        )
        .toBe(true);
      if (
        viewport.width === 390 ||
        viewport.width === 844 ||
        viewport.width === 1440
      )
        await page.screenshot({
          path: info.outputPath(
            `air-hockey-p${side + 1}-${viewport.width}x${viewport.height}.png`,
          ),
        });
    }
    expect(errors).toEqual([]);
  });

  test(`air hockey ${version} P${side + 1} follows the mouse outside the court and keeps renewing clamped targets`, async ({
    page,
  }) => {
    const { surface, push, intents } = await openPlaySurface(
      page,
      "air-hockey",
      version,
    );
    const view = await fixture();
    view.yourSide = side;
    await push(view);
    const canvas = surface.locator("#court-canvas canvas");
    await expect(canvas).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await renderedFrame(surface);
      const own = await clientPoint(canvas, 300, 765);
      const lower = await clientPoint(canvas, 450, 918);
      const left = await clientPoint(canvas, 150, 765);
      await page.mouse.move(own.x, own.y);
      await expect
        .poll(async () => (await intents()).at(-1))
        .toEqual({ type: "CONTROL", target: { x: 5000, y: 7500 } });
      const before = (await intents()).length;
      for (const { x, y, target } of [
        { x: 1, y: own.y, target: { x: 0, y: 7500 } },
        { x: 1, y: lower.y, target: { x: 0, y: 9000 } },
        {
          x: viewport.width - 2,
          y: lower.y,
          target: { x: 10000, y: 9000 },
        },
        {
          x: left.x,
          y: viewport.height - 2,
          target: { x: 2500, y: 10000 },
        },
        {
          x: lower.x,
          y: viewport.height - 2,
          target: { x: 7500, y: 10000 },
        },
        { x: left.x, y: 1, target: { x: 2500, y: 5000 } },
        { x: viewport.width - 2, y: 1, target: { x: 10000, y: 5000 } },
      ]) {
        await page.mouse.move(x, y);
        await expect
          .poll(async () => (await intents()).at(-1))
          .toEqual({ type: "CONTROL", target });
      }
      const stationaryCount = (await intents()).length;
      await expect
        .poll(async () => (await intents()).length)
        .toBeGreaterThan(stationaryCount);
      expect((await intents()).at(-1)).toEqual({
        type: "CONTROL",
        target: { x: 10000, y: 5000 },
      });
      expect((await intents()).slice(before)).not.toContainEqual({
        type: "CONTROL",
        target: null,
      });
    }
  });
}

test("air hockey mouse and real single touch release, clamp, reconnect and resign safely", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const { surface, push, intents, dispose } = await openPlaySurface(
      page,
      "air-hockey",
      "1.1.0",
    );
    const view = await fixture();
    await push(view);
    const canvas = surface.locator("#court-canvas canvas");
    await expect(canvas).toBeVisible();
    const own = await clientPoint(canvas, 180, 765);
    await page.mouse.move(own.x, own.y);
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "CONTROL", target: { x: 3000, y: 7500 } });
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "CONTROL", target: { x: 0, y: 5000 } });
    await surface
      .locator("#root")
      .evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "CONTROL", target: null });
    const touch = await context.newCDPSession(page);
    const opposing = await clientPoint(canvas, 300, 255);
    const count = (await intents()).length;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...opposing }],
    });
    await renderedFrame(surface);
    expect((await intents()).length).toBe(count);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...own }],
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toMatchObject({ type: "CONTROL", target: { x: 3000, y: 7500 } });
    const other = await clientPoint(canvas, 510, 850);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, ...own },
        { id: 2, ...other },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, ...opposing },
        { id: 2, ...other },
      ],
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "CONTROL", target: { x: 5000, y: 5000 } });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "CONTROL", target: null });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 3, ...own }],
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toMatchObject({ target: { x: 3000, y: 7500 } });
    await push(view, { connectionState: "reconnecting" });
    await expect(surface.locator("#connection-cover")).toBeVisible();
    await push(view);
    await expect(surface.locator("#connection-cover")).toBeHidden();
    const reconnectedCount = (await intents()).length;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 3, ...other }],
    });
    await renderedFrame(surface);
    expect((await intents()).length).toBe(reconnectedCount);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.mouse.move(own.x, own.y);
    await expect
      .poll(async () => (await intents()).at(-1))
      .toMatchObject({ target: { x: 3000, y: 7500 } });
    await surface
      .locator("#root")
      .evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "CONTROL", target: null });
    await hostCommand(page, {
      type: "host.command",
      control: "RESIGN",
      clientIntentId: "resign-test",
    });
    await expect
      .poll(async () => (await intents()).at(-1))
      .toEqual({ type: "RESIGN" });
    const resignedCount = (await intents()).length;
    await page.mouse.move(other.x, other.y);
    await renderedFrame(surface);
    expect((await intents()).length).toBe(resignedCount);
    await dispose();
    await expect(surface.locator("#root")).toContainText("球场已关闭");
    await touch.detach();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const reducedMotion of [false, true]) {
  test(`air hockey authoritative feedback, audio unlock and reset (reduced ${reducedMotion})`, async ({
    page,
  }) => {
    const { surface, push } = await openPlaySurface(
      page,
      "air-hockey",
      "1.1.0",
      { reducedMotion },
    );
    const view = await fixture();
    await push(view);
    const canvas = surface.locator("#court-canvas canvas");
    await expect(canvas).toBeVisible();
    const audio = surface.getByRole("button", { name: "音效", exact: true });
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    const baseline = await pixel(canvas, 12, 612);
    view.tick = 1;
    view.events = [
      {
        id: 1,
        tick: 0,
        kind: "WALL",
        x: 0,
        y: 600000,
        strength: 1000,
        side: null,
        edge: "LEFT",
      },
    ];
    await push(view);
    await expect
      .poll(
        () =>
          canvas.evaluate((node) => {
            const ctx = (node as HTMLCanvasElement).getContext("2d");
            if (!ctx) return 0;
            const pixels = ctx.getImageData(8, 300, 9, 620).data;
            let bright = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if ((pixels[i] ?? 0) > 100 && (pixels[i + 1] ?? 0) > 140)
                bright++;
            return bright;
          }),
        { intervals: [10, 20, 40] },
      )
      .toBeGreaterThan(5);
    await expect.poll(() => pixel(canvas, 12, 612)).toEqual(baseline);
    await push(view);
    await renderedFrame(surface);
    expect(await pixel(canvas, 12, 612)).toEqual(baseline);
    view.tick = 2;
    view.phase = "RALLY";
    view.puck = { x: 450000, y: 700000 };
    await push(view);
    await expect.poll(() => pixel(canvas, 462, 712)).toEqual([241, 245, 249]);
    view.tick = 3;
    view.rally = 2;
    view.phase = "SERVE";
    view.puck = { x: 300000, y: 510000 };
    await push(view);
    await expect.poll(() => pixel(canvas, 312, 522)).toEqual([241, 245, 249]);
    await push(view, { connectionState: "reconnecting" });
    await push(view);
    await renderedFrame(surface);
    expect(await pixel(canvas, 12, 612)).toEqual(baseline);
  });
}
