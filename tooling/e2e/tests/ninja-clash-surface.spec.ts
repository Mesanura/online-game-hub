import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";
const fixture = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../game-surfaces/ninja-clash/tests/fixtures/play.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
test("ninja pixel arena and controls fit desktop, portrait and landscape", async ({
  browser,
}, info) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const { surface, push } = await openPlaySurface(
      page,
      "ninja-clash",
      "1.0.0",
    );
    await push(await fixture(), { tick: 180 });
    await expect(surface.locator("#stage canvas")).toBeVisible();
    await expect(surface.locator(".score")).toHaveCount(4);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 320, height: 740 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() =>
          surface.locator(".play").evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return [
              ...el.querySelectorAll(".control-deck button, #stage canvas"),
            ].every((node) => {
              const b = node.getBoundingClientRect();
              return (
                b.width > 0 &&
                b.height > 0 &&
                b.left >= 0 &&
                b.right <= rect.right + 1 &&
                b.bottom <= window.innerHeight + 1
              );
            });
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`ninja-${size.width}.png`),
      });
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("ninja keyboard, simultaneous touch, reconnect and countdown release controls", async ({
  browser,
}) => {
  const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 844, height: 390 },
    }),
    page = await context.newPage();
  try {
    const { surface, push, intents, dispose } = await openPlaySurface(
      page,
      "ninja-clash",
      "1.0.0",
    );
    const view = await fixture();
    await push(view, { tick: 180 });
    await surface.locator("#stage").click();
    await page.keyboard.down("KeyD");
    await page.keyboard.press("KeyJ");
    await expect
      .poll(intents)
      .toEqual(
        expect.arrayContaining([
          { type: "MOVE", direction: 1 },
          { type: "ATTACK" },
        ]),
      );
    await page.keyboard.up("KeyD");
    await expect
      .poll(intents)
      .toEqual(expect.arrayContaining([{ type: "MOVE", direction: 0 }]));
    const cdp = await context.newCDPSession(page);
    const left = await surface.locator('[data-direction="-1"]').boundingBox(),
      jump = await surface.locator('[data-action="JUMP"]').boundingBox();
    if (!left || !jump) throw new Error("Missing controls");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: left.x + left.width / 2, y: left.y + left.height / 2 },
        { id: 2, x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 },
      ],
    });
    await expect
      .poll(intents)
      .toEqual(
        expect.arrayContaining([
          { type: "MOVE", direction: -1 },
          { type: "JUMP" },
        ]),
      );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await push(
      { ...view, phase: "COUNTDOWN", countdown: 180, round: 2 },
      { tick: 181 },
    );
    await expect(surface.locator("#banner-title")).toHaveText("3");
    await expect(surface.locator('[data-action="SLIDE"]')).toBeDisabled();
    await push(view, { tick: 182, connectionState: "reconnecting" });
    await expect(surface.locator("#connection")).toBeVisible();
    await push({ ...view, tick: 183 }, { tick: 183 });
    await expect(surface.locator("#connection")).toBeHidden();
    await expect(surface.locator('[data-direction="-1"]')).toHaveAttribute(
      "data-held",
      "false",
    );
    await dispose();
    await expect(surface.locator(".loading")).toHaveText("竞技场已关闭。");
  } finally {
    await context.close();
  }
});
