import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

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

test.beforeAll(async () => {
  harness = await startE2eHarness();
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
  await pageA.getByTestId("starter-owner").click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) throw new Error("Pong invite link was not rendered.");
  await pageB.goto(inviteUrl);
  await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局进行中"),
    ),
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
  const canvas = page.getByTestId("pong-canvas").locator("canvas");
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
}

async function readScore(page: Page): Promise<readonly [number, number]> {
  const [left, right] = await Promise.all([
    page.getByTestId("score-left").textContent(),
    page.getByTestId("score-right").textContent(),
  ]);
  return [Number(left), Number(right)];
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

    const initialCanvasBox = await pageA
      .getByTestId("pong-canvas")
      .locator("canvas")
      .boundingBox();
    expect(initialCanvasBox).not.toBeNull();
    await pageA.keyboard.down("ArrowUp");
    await expect(
      pageA.getByTestId("acknowledged-input-sequence"),
    ).not.toHaveText("0");
    await pageA.keyboard.up("ArrowUp");
    await expect
      .poll(() =>
        pageA
          .getByTestId("server-tick")
          .textContent()
          .then((value) => Number(value)),
      )
      .toBeGreaterThan(1);
    const afterInputCanvasBox = await pageA
      .getByTestId("pong-canvas")
      .locator("canvas")
      .boundingBox();
    expect(afterInputCanvasBox).toEqual(initialCanvasBox);

    await expect
      .poll(
        async () => {
          const stored = await roomStore.getByRoomCode(round.roomCode);
          return stored?.currentRound?.tick ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(1);
    await expect
      .poll(
        async () => {
          const [left, right] = await readScore(pageA);
          return left + right;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const scoredSnapshot = await readScore(pageA);
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

    await Promise.all(
      [reconnected, pageB].map((page) =>
        expect(page.getByTestId("match-status")).toHaveText("对局已完成", {
          timeout: 20_000,
        }),
      ),
    );
    await expect(reconnected.getByTestId("pong-outcome")).toContainText(
      '"reason":"SCORE"',
    );
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
    expect(JSON.stringify(replayPayload)).not.toContain("rngSeed");
    expect(JSON.stringify(replayPayload)).not.toContain("canonicalInputLog");
  } finally {
    await database.close();
    await closeContexts(contextA, contextB);
  }
});
