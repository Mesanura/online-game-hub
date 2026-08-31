import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

function capturePageErrors(page: Page, errors: string[]): void {
  page.on("pageerror", (error) => errors.push(error.message));
}

async function expectRevision(
  pages: readonly Page[],
  revision: number,
): Promise<void> {
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("revision")).toHaveText(String(revision)),
    ),
  );
}

async function playAcceptedStone(
  actor: Page,
  viewers: readonly Page[],
  cell: number,
  revision: number,
): Promise<void> {
  const button = actor.locator(`[data-cell-index="${cell}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await expectRevision(viewers, revision);
}

async function readHistory(
  page: Page,
): Promise<readonly Record<string, unknown>[]> {
  const response = await page.request.get(`${harness.webUrl}/api/matches`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    readonly matches?: readonly Record<string, unknown>[];
  };
  return body.matches ?? [];
}

test("two guests create, join, synchronize, and complete authoritative Gomoku", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const browserErrors: string[] = [];
  capturePageErrors(pageA, browserErrors);
  capturePageErrors(pageB, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const gomokuCard = pageA.getByRole("article").filter({ hasText: "五子棋" });
  await expect(gomokuCard).toContainText("2–2");
  await gomokuCard.getByRole("link", { name: "创建或加入房间" }).click();
  await expect(pageA).toHaveURL(/\/games\/gomoku$/u);
  await expect(pageA.getByRole("heading", { level: 1 })).toHaveText("五子棋");
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("match-status")).toHaveText("等待另一位玩家");

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Gomoku did not expose an invitation URL.");
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toBe("/games/gomoku");
  const roomCode = invitation.searchParams.get("roomCode");
  if (roomCode === null)
    throw new Error("Gomoku invitation omitted its room code.");

  await pageB.goto(inviteUrl);
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("connection-state")).toHaveText("已连接");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("room-code")).toHaveText(roomCode);
      await expect(
        page.getByRole("grid", { name: "五子棋棋盘" }),
      ).toBeVisible();
      await expect(page.locator("[data-cell-index]")).toHaveCount(225);
      await expect(page.getByText("15 × 15 棋盘")).toBeVisible();
    }),
  );
  await expect(pageA.getByTestId("player-stone")).toContainText("黑方");
  await expect(pageB.getByTestId("player-stone")).toContainText("白方");
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Gomoku player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);

  const illegalCell = pageB.locator('[data-cell-index="105"]');
  await expect(illegalCell).toBeDisabled();
  await illegalCell.evaluate((element) => {
    const propsKey = Object.keys(element).find((key) =>
      key.startsWith("__reactProps$"),
    );
    if (propsKey === undefined)
      throw new Error("React cell props unavailable.");
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    if (
      props === null ||
      typeof props !== "object" ||
      !("onClick" in props) ||
      typeof props.onClick !== "function"
    ) {
      throw new Error("The Gomoku cell has no intent handler.");
    }
    props.onClick();
  });
  await expect(pageB.getByTestId("command-rejection")).toContainText(
    "还没有轮到你",
  );
  await expectRevision([pageA, pageB], 0);

  const winningPlacements = [
    [pageA, 105],
    [pageB, 0],
    [pageA, 106],
    [pageB, 1],
    [pageA, 107],
    [pageB, 2],
    [pageA, 108],
    [pageB, 3],
    [pageA, 109],
  ] as const;
  for (const [index, [actor, cell]] of winningPlacements.entries()) {
    await playAcceptedStone(actor, [pageA, pageB], cell, index + 1);
  }
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  await expect(pageA.getByTestId("turn-status")).toContainText("胜者：你");
  await expect(pageB.getByTestId("turn-status")).toContainText("胜者：对手");
  for (const cell of [105, 106, 107, 108, 109]) {
    await expect(pageA.locator(`[data-cell-index="${cell}"]`)).toHaveAttribute(
      "data-stone",
      "BLACK",
    );
  }

  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null)
    throw new Error("The completed Gomoku room was not stored.");
  expect(room).toMatchObject({
    gameId: "gomoku",
    gameVersion: "1.0.0",
    initialConfig: { boardSize: 15, winLength: 5 },
    revision: 9,
    status: "completed",
  });
  const replay = await harness.gameServer.replayStore.get(room.replayId);
  expect(replay?.actions).toHaveLength(9);
  expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
    status: "verified",
    rng: { cursor: 0 },
    outcome: { type: "WIN", winnerSlotId: "slot-1" },
  });

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "gomoku-e2e-replay",
    maxConnections: 2,
  });
  try {
    const rebuiltReplay = await new PostgresReplayStore(
      rebuiltClient.database,
    ).get(room.replayId);
    expect(rebuiltReplay?.header).toMatchObject({
      replayFormatVersion: 1,
      gameId: "gomoku",
      gameVersion: "1.0.0",
      initialConfig: { boardSize: 15, winLength: 5 },
    });
    expect(rebuiltReplay?.actions).toHaveLength(9);
    expect(verifyReplay(rebuiltReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });
  } finally {
    await rebuiltClient.close();
  }

  const [historyA, historyB] = await Promise.all([
    readHistory(pageA),
    readHistory(pageB),
  ]);
  expect(historyA).toEqual([
    expect.objectContaining({
      gameId: "gomoku",
      gameVersion: "1.0.0",
      finalRevision: 9,
      playerSlotId: slotA,
      replayAvailable: true,
    }),
  ]);
  expect(historyB).toEqual([
    expect.objectContaining({
      matchId: historyA[0]?.matchId,
      playerSlotId: slotB,
    }),
  ]);

  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});
