import { expect, test } from "@playwright/test";
import type { BrowserContext, FrameLocator, Page } from "@playwright/test";

import {
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyRealtimeReplay } from "@online-game-hub/realtime-game-sdk";

import { registerE2eAccount } from "../src/account.js";
import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

function pongSurface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

test.beforeAll(async () => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
});

test.afterAll(async () => {
  await harness?.stop();
});

async function activePongRound(
  pageA: Page,
  pageB: Page,
): Promise<{
  readonly inviteUrl: string;
  readonly roomCode: string;
  readonly slotA: string;
  readonly slotB: string;
}> {
  await pageA.goto(`${harness.webUrl}/games/pong`);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/pong/1.2.1/setup/index.html",
  );
  await pongSurface(pageA).getByRole("button", { name: "房主在左" }).click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) throw new Error("Pong invite link was not rendered.");
  await pageB.goto(inviteUrl);
  await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageB.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/pong/1.2.1/setup/index.html",
  );
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/pong/1.2.1/play/index.html",
      );
    }),
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined || slotA === slotB) {
    throw new Error("Pong players did not receive distinct stable slots.");
  }
  return {
    inviteUrl,
    roomCode: new URL(inviteUrl).pathname.split("/").at(-1) ?? "",
    slotA,
    slotB,
  };
}

async function expectNonBlankCanvas(page: Page): Promise<void> {
  const canvas = pongSurface(page).locator("#pong-canvas canvas");
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const context = canvas.getContext("2d");
          if (context === null) return false;
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index] !== 0 ||
              pixels[index + 1] !== 0 ||
              pixels[index + 2] !== 0 ||
              pixels[index + 3] !== 0
            ) {
              return true;
            }
          }
          return false;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
  const dimensions = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
  expect(dimensions).toEqual({ width: 800, height: 400 });
  const boundaryPixels = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    return [
      [400, 4],
      [796, 200],
      [400, 396],
      [4, 200],
    ].map(([x, y]) =>
      Array.from(context.getImageData(x ?? 0, y ?? 0, 1, 1).data),
    );
  });
  expect(boundaryPixels).not.toBeNull();
  for (const boundaryPixel of boundaryPixels ?? []) {
    expect(boundaryPixel.slice(0, 3)).not.toEqual([20, 40, 39]);
  }
}

async function expectResponsivePongStage(page: Page): Promise<void> {
  for (const viewport of [
    { width: 2560, height: 1440 },
    { width: 1707, height: 960 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const iframe = page.getByTestId("game-surface-iframe");
    const stage = pongSurface(page).locator(".pong-stage");
    const host = pongSurface(page).locator("#pong-canvas");
    const canvas = pongSurface(page).locator("#pong-canvas canvas");
    await expect
      .poll(async () => {
        const [iframeBox, stageBox, hostBox, canvasBox, frameStyle, pageFits] =
          await Promise.all([
            iframe.boundingBox(),
            stage.boundingBox(),
            host.boundingBox(),
            canvas.boundingBox(),
            host.evaluate((element) => {
              const frame = getComputedStyle(element, "::after");
              return {
                borderWidth: frame.borderTopWidth,
                borderColor: frame.borderTopColor,
              };
            }),
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth &&
                document.documentElement.scrollHeight <=
                  document.documentElement.clientHeight,
            ),
          ]);
        if (
          iframeBox === null ||
          stageBox === null ||
          hostBox === null ||
          canvasBox === null
        )
          return false;
        return (
          hostBox.width > 0 &&
          hostBox.height > 0 &&
          hostBox.width <= 1281 &&
          Math.abs(hostBox.width / hostBox.height - 2) < 0.01 &&
          canvasBox.width > 0 &&
          canvasBox.height > 0 &&
          Math.abs(canvasBox.width / canvasBox.height - 2) < 0.01 &&
          hostBox.x >= stageBox.x + 7 &&
          hostBox.y >= stageBox.y + 7 &&
          hostBox.x + hostBox.width <= stageBox.x + stageBox.width - 7 &&
          hostBox.y + hostBox.height <= stageBox.y + stageBox.height - 7 &&
          frameStyle.borderWidth === "2px" &&
          frameStyle.borderColor !== "rgba(0, 0, 0, 0)" &&
          canvasBox.x >= iframeBox.x - 1 &&
          canvasBox.y >= iframeBox.y - 1 &&
          canvasBox.x + canvasBox.width <= iframeBox.x + iframeBox.width + 1 &&
          canvasBox.y + canvasBox.height <=
            iframeBox.y + iframeBox.height + 1 &&
          pageFits
        );
      })
      .toBe(true);
    await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  let previousBox = "";
  await expect
    .poll(async () => {
      const box = await pongSurface(page)
        .locator("#pong-canvas canvas")
        .boundingBox();
      if (box === null) return false;
      const currentBox = JSON.stringify(box);
      const stable = currentBox === previousBox;
      previousBox = currentBox;
      return (
        stable &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 1281 &&
        box.y + box.height <= 721
      );
    })
    .toBe(true);
}

async function readScore(page: Page): Promise<readonly [number, number]> {
  const [left, right] = await Promise.all([
    pongSurface(page).getByTestId("score-left").textContent(),
    pongSurface(page).getByTestId("score-right").textContent(),
  ]);
  return [Number(left), Number(right)];
}

async function readServerTick(page: Page): Promise<number> {
  return Number(await page.getByTestId("server-tick").textContent());
}

async function advanceRealtimeTicksAndWait(
  page: Page,
  count: number,
): Promise<void> {
  const initialTick = await readServerTick(page);
  harness.advanceRealtimeTicks(count);
  await expect
    .poll(async () => {
      const status = await page
        .getByTestId("match-status")
        .getAttribute("data-status");
      return status === "completed"
        ? true
        : (await readServerTick(page)) >= initialTick + count;
    })
    .toBe(true);
}

async function advanceUntilScore(
  page: Page,
): Promise<readonly [number, number]> {
  for (let batch = 0; batch < 80; batch += 1) {
    await advanceRealtimeTicksAndWait(page, 10);
    const score = await readScore(page);
    if (score[0] + score[1] > 0) return score;
  }
  throw new Error("Pong did not score within 800 controlled ticks.");
}

async function advanceUntilCompleted(page: Page): Promise<void> {
  for (let batch = 0; batch < 200; batch += 1) {
    const status = await page
      .getByTestId("match-status")
      .getAttribute("data-status");
    if (status === "completed") return;
    await advanceRealtimeTicksAndWait(page, 10);
  }
  throw new Error("Pong did not complete within 2000 controlled ticks.");
}

async function closeContexts(
  contextA: BrowserContext,
  contextB: BrowserContext,
): Promise<void> {
  await Promise.all([contextA.close(), contextB.close()]);
}

test("two isolated browsers control authoritative Pong, reconnect, and retain records without player playback", async ({
  browser,
}) => {
  const contextA = await browser.newContext({ reducedMotion: "reduce" });
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const database = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "pong-e2e-authoritative-assertions",
    maxConnections: 2,
  });
  const roomStore = new PostgresRealtimeRoomStore(database.database);
  const replayStore = new PostgresRealtimeReplayStore(database.database);
  try {
    await Promise.all([
      registerE2eAccount(pageA.request, harness.webUrl, "pong_account_a"),
      registerE2eAccount(pageB.request, harness.webUrl, "pong_account_b"),
    ]);
    const round = await activePongRound(pageA, pageB);
    await Promise.all([
      expectNonBlankCanvas(pageA),
      expectNonBlankCanvas(pageB),
    ]);
    await expect(pongSurface(pageA).locator("html")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    await expectResponsivePongStage(pageA);

    const initialCanvasBox = await pageA
      .frameLocator('[data-testid="game-surface-iframe"]')
      .locator("#pong-canvas")
      .locator("canvas")
      .boundingBox();
    expect(initialCanvasBox).not.toBeNull();
    const meta = pongSurface(pageA).locator("#pong-meta");
    await expect(meta).toHaveText("已连接");
    await meta.evaluate((element) => {
      element.setAttribute("data-status-mutations", "0");
      new MutationObserver((mutations) => {
        element.setAttribute(
          "data-status-mutations",
          String(
            Number(element.getAttribute("data-status-mutations")) +
              mutations.length,
          ),
        );
      }).observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await pongSurface(pageA).locator("#pong-canvas").click();
    let expectedAcknowledgement = 0;
    for (const key of ["w", "s"]) {
      for (const pressed of [true, false]) {
        if (pressed) await pageA.keyboard.down(key);
        else await pageA.keyboard.up(key);
        expectedAcknowledgement += 1;
        await expect
          .poll(async () => {
            harness.advanceRealtimeTicks(1);
            return Number(
              await pageA
                .getByTestId("acknowledged-input-sequence")
                .textContent(),
            );
          })
          .toBe(expectedAcknowledgement);
        await expect(meta).toHaveText("已连接");
        await expect(meta).toHaveAttribute("data-status-mutations", "0");
      }
    }
    const afterInputCanvasBox = await pageA
      .frameLocator('[data-testid="game-surface-iframe"]')
      .locator("#pong-canvas")
      .locator("canvas")
      .boundingBox();
    expect(afterInputCanvasBox).toEqual(initialCanvasBox);

    await expect
      .poll(
        async () => {
          harness.advanceRealtimeTicks(1);
          const stored = await roomStore.getByRoomCode(round.roomCode);
          return stored?.currentRound?.tick ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(1);
    const scoredSnapshot = await advanceUntilScore(pageA);
    await expect.poll(() => readScore(pageB)).toEqual(scoredSnapshot);

    await pageA.close();
    const reconnected = await contextA.newPage();
    await reconnected.goto(round.inviteUrl);
    await expect(reconnected.getByTestId("connection-state")).toHaveText(
      "已连接",
    );
    await expect(reconnected.getByTestId("player-slot")).toHaveText(
      round.slotA,
    );
    await expect(reconnected.getByTestId("server-tick")).not.toHaveText("0");
    await expect(pageB.getByTestId("player-slot")).toHaveText(round.slotB);
    await expectNonBlankCanvas(reconnected);

    await advanceUntilCompleted(reconnected);
    await Promise.all(
      [reconnected, pageB].map((page) =>
        expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
      ),
    );
    await expect(
      pongSurface(reconnected).getByTestId("pong-outcome"),
    ).toHaveText("SCORE");
    const finalScore = await readScore(reconnected);
    expect(Math.max(...finalScore)).toBe(3);
    await expect.poll(() => readScore(pageB)).toEqual(finalScore);

    const completedRoom = await roomStore.getByRoomCode(round.roomCode);
    expect(completedRoom?.currentRound).toMatchObject({
      status: "completed",
      outcome: {
        type: "WIN",
        reason: "SCORE",
        scores: expect.arrayContaining([3]),
      },
    });
    const replayId = completedRoom?.currentRound?.replayId;
    if (replayId === undefined)
      throw new Error("Pong replay id was not persisted.");
    const persistedReplay = await replayStore.get(replayId);
    expect(persistedReplay).not.toBeNull();
    expect(persistedReplay?.header.gameVersion).toBe("1.2.0");
    expect(
      persistedReplay?.events.slice(0, 4).map((event) => event.input),
    ).toEqual([
      { type: "DIRECTION", direction: -1 },
      { type: "DIRECTION", direction: 0 },
      { type: "DIRECTION", direction: 1 },
      { type: "DIRECTION", direction: 0 },
    ]);
    expect(
      verifyRealtimeReplay(persistedReplay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });

    const historyResponse = await reconnected.request.get(
      `${harness.webUrl}/api/matches`,
    );
    expect(historyResponse.status()).toBe(200);
    const history = (await historyResponse.json()) as {
      readonly matches?: readonly {
        readonly matchId: string;
        readonly gameId: string;
        readonly replayAvailable: boolean;
      }[];
    };
    const match = history.matches?.find(
      (candidate) => candidate.gameId === "pong",
    );
    if (match === undefined)
      throw new Error("Completed Pong match was not in private history.");
    expect(match.replayAvailable).toBe(false);

    const replayResponse = await reconnected.request.get(
      `${harness.webUrl}/api/matches/${encodeURIComponent(match.matchId)}/replay`,
    );
    expect(replayResponse.status()).toBe(409);
    expect(replayResponse.headers()["cache-control"]).toBe("no-store, private");
    expect(await replayResponse.json()).toEqual({
      code: "PLAYER_PLAYBACK_NOT_SUPPORTED",
    });

    await reconnected.goto(`${harness.webUrl}/account/matches`);
    await expect(
      reconnected.getByRole("article").filter({ hasText: "乒乓对战" }),
    ).toBeVisible();
    await expect(
      reconnected.getByTestId(`replay-entry-${match.matchId}`),
    ).toHaveCount(0);

    await reconnected.goto(
      `${harness.webUrl}/account/matches/${encodeURIComponent(match.matchId)}/replay`,
    );
    await expect(reconnected.getByTestId("replay-error")).toBeVisible();
    await expect(reconnected.getByTestId("game-surface-iframe")).toHaveCount(0);
  } finally {
    await database.close();
    await closeContexts(contextA, contextB);
  }
});

async function centerMarkerPixels(
  page: Page,
): Promise<{ total: number; outsideBall: number }> {
  return pongSurface(page)
    .locator("#pong-canvas canvas")
    .evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("2d");
      if (context === null) throw new Error("Missing Pong canvas context.");
      const pixels = context.getImageData(370, 170, 60, 60).data;
      let total = 0;
      let outsideBall = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          (pixels[index] ?? 0) < 250 ||
          (pixels[index + 1] ?? 0) < 240 ||
          (pixels[index + 2] ?? 0) < 190
        )
          continue;
        total += 1;
        const pixelIndex = index / 4;
        if (
          Math.hypot((pixelIndex % 60) - 30, Math.floor(pixelIndex / 60) - 30) >
          12
        )
          outsideBall += 1;
      }
      return { total, outsideBall };
    });
}

async function serveArrowPixels(
  page: Page,
): Promise<{ total: number; matchingBorder: number; white: number }> {
  return pongSurface(page)
    .locator("#pong-canvas canvas")
    .evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("2d");
      if (context === null) throw new Error("Missing Pong canvas context.");
      const border = context.getImageData(4, 200, 1, 1).data;
      const pixels = context.getImageData(360, 84, 80, 32).data;
      let total = 0;
      let matchingBorder = 0;
      let white = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const x = 360 + ((index / 4) % 80);
        if (x >= 396 && x <= 404) continue;
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        if (red > 60 && green > 80 && blue > 60) total += 1;
        if (
          Math.abs(red - (border[0] ?? 0)) <= 1 &&
          Math.abs(green - (border[1] ?? 0)) <= 1 &&
          Math.abs(blue - (border[2] ?? 0)) <= 1
        )
          matchingBorder += 1;
        if (red > 230 && green > 230 && blue > 230) white += 1;
      }
      return { total, matchingBorder, white };
    });
}

test("Pong flashes a border-colored horizontal arrow exactly twice, preserves preparation on reconnect, and supports reduced motion", async ({
  browser,
}, testInfo) => {
  const contextA = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
  });
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const round = await activePongRound(pageA, pageB);
    for (const page of [pageA, pageB]) {
      await expectNonBlankCanvas(page);
      await expect
        .poll(async () => (await serveArrowPixels(page)).matchingBorder)
        .toBeGreaterThan(150);
      expect((await serveArrowPixels(page)).white).toBe(0);
      expect((await centerMarkerPixels(page)).total).toBe(0);
    }
    await pageA.screenshot({ path: testInfo.outputPath("serve-desktop.png") });
    await pageB.screenshot({ path: testInfo.outputPath("serve-mobile.png") });
    for (let phase = 1; phase <= 3; phase += 1) {
      await advanceRealtimeTicksAndWait(pageA, 30);
      await expect.poll(() => readServerTick(pageB)).toBe(phase * 30);
      if (phase % 2 === 1) {
        await expect
          .poll(async () => (await serveArrowPixels(pageA)).total)
          .toBe(0);
      } else {
        await expect
          .poll(async () => (await serveArrowPixels(pageA)).matchingBorder)
          .toBeGreaterThan(150);
      }
      await expect
        .poll(async () => (await serveArrowPixels(pageB)).matchingBorder)
        .toBeGreaterThan(150);
      await expect.poll(() => readScore(pageA)).toEqual([0, 0]);
      if (phase === 3) {
        await pageA.reload();
        await expect(pageA.getByTestId("player-slot")).toHaveText(round.slotA);
        await expect.poll(() => readServerTick(pageA)).toBe(90);
        await expectNonBlankCanvas(pageA);
        await expect
          .poll(async () => (await serveArrowPixels(pageA)).total)
          .toBe(0);
        await pageA.screenshot({
          path: testInfo.outputPath("serve-hidden-reconnected.png"),
        });
      }
    }
    await advanceRealtimeTicksAndWait(pageA, 29);
    await expect
      .poll(async () => (await serveArrowPixels(pageA)).total)
      .toBe(0);
    await expect
      .poll(async () => (await centerMarkerPixels(pageA)).total)
      .toBe(0);
    await advanceRealtimeTicksAndWait(pageA, 1);
    await expect
      .poll(async () => (await serveArrowPixels(pageA)).total)
      .toBe(0);
    await expect
      .poll(async () => (await serveArrowPixels(pageB)).total)
      .toBe(0);
    await expect
      .poll(async () => (await centerMarkerPixels(pageA)).total)
      .toBeGreaterThan(100);
    await advanceRealtimeTicksAndWait(pageA, 10);
    await expect
      .poll(async () => (await centerMarkerPixels(pageA)).total)
      .toBe(0);
    await pageA.screenshot({ path: testInfo.outputPath("serve-launched.png") });
  } finally {
    await closeContexts(contextA, contextB);
  }
});
