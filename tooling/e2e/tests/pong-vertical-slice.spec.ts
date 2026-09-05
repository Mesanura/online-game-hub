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
    "/game-surfaces/pong/1.0.4/setup/index.html",
  );
  await pongSurface(pageA).getByRole("button", { name: "房主发球" }).click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) throw new Error("Pong invite link was not rendered.");
  await pageB.goto(inviteUrl);
  await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageB.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/pong/1.0.4/setup/index.html",
  );
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/pong/1.0.4/play/index.html",
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
  for (let batch = 0; batch < 80; batch += 1) {
    const status = await page
      .getByTestId("match-status")
      .getAttribute("data-status");
    if (status === "completed") return;
    await advanceRealtimeTicksAndWait(page, 10);
  }
  throw new Error("Pong did not complete within 800 controlled ticks.");
}

async function closeContexts(
  contextA: BrowserContext,
  contextB: BrowserContext,
): Promise<void> {
  await Promise.all([contextA.close(), contextB.close()]);
}

test("two isolated browsers control authoritative Pong, reconnect, and read private replay", async ({
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
    await pongSurface(pageA).locator("#pong-canvas").click();
    await pageA.keyboard.down("ArrowUp");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return pageA.getByTestId("acknowledged-input-sequence").textContent();
      })
      .not.toBe("0");
    await pageA.keyboard.up("ArrowUp");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return pageA
          .getByTestId("server-tick")
          .textContent()
          .then((value) => Number(value));
      })
      .toBeGreaterThan(1);
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
    expect(match.replayAvailable).toBe(true);

    const replayResponse = await reconnected.request.get(
      `${harness.webUrl}/api/matches/${encodeURIComponent(match.matchId)}/replay`,
    );
    expect(replayResponse.status()).toBe(200);
    const replayPayload = (await replayResponse.json()) as {
      readonly runtime: "realtime";
      readonly match: { readonly finalRevision: number };
      readonly frames: readonly {
        readonly tick: number;
        readonly view: unknown;
      }[];
    };
    expect(replayPayload.runtime).toBe("realtime");
    expect(replayPayload.frames.length - 1).toBe(
      replayPayload.match.finalRevision,
    );
    expect(replayPayload.frames[0]?.tick).toBe(0);
    expect(replayPayload.frames.at(-1)?.tick).toBe(
      replayPayload.match.finalRevision,
    );
    expect(
      replayPayload.frames.every((frame, index, frames) => {
        const previous = frames[index - 1];
        return (
          index === 0 || (previous !== undefined && frame.tick > previous.tick)
        );
      }),
    ).toBe(true);
    expect(replayPayload.frames.at(-1)?.view).toMatchObject({
      field: { width: 800_000, height: 400_000 },
      scores: finalScore,
      outcome: { reason: "SCORE" },
    });
    expect(JSON.stringify(replayPayload)).not.toMatch(
      /canonicalInputLog|rawState|rngSeed|session|ticket/u,
    );

    await reconnected.goto(
      `${harness.webUrl}/account/matches/${encodeURIComponent(match.matchId)}/replay`,
    );
    await expect(reconnected.getByTestId("replay-page")).toBeVisible();
    await expect(
      reconnected.getByTestId("game-surface-iframe"),
    ).toHaveAttribute("src", "/game-surfaces/pong/1.0.4/replay/index.html");
    await expectNonBlankCanvas(reconnected);
    const replayFrameCount = replayPayload.frames.length;
    await reconnected.getByTestId("replay-last").click();
    await expect(reconnected.getByTestId("replay-frame-count")).toHaveText(
      `${replayFrameCount} / ${replayFrameCount}`,
    );
    await expect.poll(() => readScore(reconnected)).toEqual(finalScore);
    await reconnected.getByTestId("replay-first").click();
    await expect(reconnected.getByTestId("replay-frame-count")).toHaveText(
      `1 / ${replayFrameCount}`,
    );
    await expect.poll(() => readScore(reconnected)).toEqual([0, 0]);
    await reconnected.getByTestId("replay-next").click();
    await expect(reconnected.getByTestId("replay-frame-count")).toHaveText(
      `2 / ${replayFrameCount}`,
    );
  } finally {
    await database.close();
    await closeContexts(contextA, contextB);
  }
});
