import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

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

function handleResignDialog(
  page: Page,
  operation: "accept" | "dismiss",
): Promise<string> {
  return new Promise((resolve, reject) => {
    page.once("dialog", (dialog) => {
      const message = dialog.message();
      const handling =
        operation === "accept" ? dialog.accept() : dialog.dismiss();
      void handling.then(() => resolve(message), reject);
    });
  });
}

async function playAcceptedDrop(
  actor: Page,
  viewers: readonly Page[],
  column: number,
  revision: number,
): Promise<void> {
  const button = actor.locator(`[data-column-index="${column}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await expectRevision(viewers, revision);
}

async function assertIsolatedGuestCookies(
  contextA: BrowserContext,
  contextB: BrowserContext,
): Promise<void> {
  const [cookiesA, cookiesB] = await Promise.all([
    contextA.cookies(harness.webUrl),
    contextB.cookies(harness.webUrl),
  ]);
  const cookieA = cookiesA.find((cookie) => cookie.name === "ogh_guest");
  const cookieB = cookiesB.find((cookie) => cookie.name === "ogh_guest");
  if (cookieA === undefined || cookieB === undefined) {
    throw new Error("An isolated browser context is missing its guest cookie.");
  }
  expect(cookieA.httpOnly).toBe(true);
  expect(cookieB.httpOnly).toBe(true);
  expect(cookieA.value).not.toBe(cookieB.value);
}

async function assertCompletedReplay(
  roomCode: string,
  roundNumber: number,
): Promise<string> {
  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null) {
    throw new Error("The completed Connect Four room was not persisted.");
  }
  expect(room).toMatchObject({
    gameId: "connect-four",
    gameVersion: "1.0.0",
    currentRound: { roundNumber, revision: 7, status: "completed" },
  });
  const currentRound = room.currentRound;
  if (currentRound === null) {
    throw new Error("The completed Connect Four round was not persisted.");
  }
  const replay = await harness.gameServer.replayStore.get(
    currentRound.replayId,
  );
  expect(replay?.actions).toHaveLength(7);
  expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
    status: "verified",
    rng: { cursor: 0 },
    outcome: { type: "WIN", winnerSlotId: "slot-1" },
  });

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: `connect-four-e2e-replay-round-${roundNumber}`,
    maxConnections: 2,
  });
  try {
    const rebuiltReplay = await new PostgresReplayStore(
      rebuiltClient.database,
    ).get(currentRound.replayId);
    expect(rebuiltReplay?.header).toMatchObject({
      replayFormatVersion: 1,
      gameId: "connect-four",
      gameVersion: "1.0.0",
    });
    expect(rebuiltReplay?.actions).toHaveLength(7);
    expect(verifyReplay(rebuiltReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });
  } finally {
    await rebuiltClient.close();
  }
  return currentRound.replayId;
}

async function readHistory(
  page: Page,
): Promise<readonly Record<string, unknown>[]> {
  const response = await page.request.get(`${harness.webUrl}/api/matches`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  const body = (await response.json()) as {
    readonly matches?: readonly Record<string, unknown>[];
  };
  return body.matches ?? [];
}

async function startActiveRound(
  pageA: Page,
  pageB: Page,
): Promise<{
  readonly roomCode: string;
  readonly slotA: string;
  readonly slotB: string;
}> {
  await pageA.goto(`${harness.webUrl}/games/connect-four`);
  await pageA.getByTestId("create-room").click();
  await pageA.getByTestId("starter-owner").click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Connect Four did not expose an invitation URL.");
  const roomCode = new URL(inviteUrl).pathname.split("/").at(-1) ?? "";

  await pageB.goto(inviteUrl);
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局进行中"),
    ),
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error(
      "A connected Connect Four player is missing its stable slot.",
    );
  }
  return { roomCode, slotA, slotB };
}

test("two guests play two authoritative Connect Four rounds with independent replay and private history", async ({
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
  const connectFourCard = pageA
    .getByRole("article")
    .filter({ hasText: "四子棋" });
  await expect(connectFourCard).toContainText("2–2");
  await connectFourCard.getByRole("link", { name: "创建或加入房间" }).click();
  await expect(pageA).toHaveURL(/\/games\/connect-four$/u);
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("match-status")).toHaveCount(0);
  await expect(pageA.getByTestId("player-count-notice")).toHaveAttribute(
    "data-state",
    "waiting",
  );
  await pageA.getByTestId("starter-owner").click();

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) {
    throw new Error("Connect Four did not expose an invitation URL.");
  }
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/connect-four\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  const roomCode = invitation.pathname.split("/").at(-1) ?? "";

  await pageB.goto(`${harness.webUrl}/games`);
  await expect(
    pageB.getByRole("article").filter({ hasText: "四子棋" }),
  ).toBeVisible();
  await pageB.goto(inviteUrl);
  await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/2 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("connection-state")).toHaveText("已连接");
      await expect(page.getByTestId("game-stage")).toBeVisible();
      await expect(page.getByTestId("player-count-notice")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("room-code")).toHaveText(roomCode);
      await expect(page.locator("[data-column-index]")).toHaveCount(7);
      await expect(page.locator("[data-cell-index]")).toHaveCount(42);
    }),
  );
  await assertIsolatedGuestCookies(contextA, contextB);
  await expect(pageA.getByTestId("player-disc")).toContainText("红方");
  await expect(pageB.getByTestId("player-disc")).toContainText("黄方");
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);

  const illegalColumn = pageB.locator('[data-column-index="0"]');
  await expect(illegalColumn).toBeDisabled();
  await illegalColumn.evaluate((element) => {
    const propsKey = Object.keys(element).find((key) =>
      key.startsWith("__reactProps$"),
    );
    if (propsKey === undefined) {
      throw new Error("React column button props were not available.");
    }
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    if (
      props === null ||
      typeof props !== "object" ||
      !("onClick" in props) ||
      typeof props.onClick !== "function"
    ) {
      throw new Error("The column button has no intent handler.");
    }
    props.onClick();
  });
  await expect(pageB.getByTestId("command-rejection")).toContainText(
    "还没有轮到你",
  );
  await expectRevision([pageA, pageB], 0);
  await expect(pageA.locator('[data-cell-index="35"]')).toHaveAttribute(
    "data-disc",
    "EMPTY",
  );

  const winningDrops = [
    [pageA, 0],
    [pageB, 0],
    [pageA, 1],
    [pageB, 1],
    [pageA, 2],
    [pageB, 2],
    [pageA, 3],
  ] as const;
  for (const [index, [actor, column]] of winningDrops.entries()) {
    await playAcceptedDrop(actor, [pageA, pageB], column, index + 1);
  }
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  await expect(pageA.getByTestId("turn-status")).toContainText("胜者：你");
  await expect(pageB.getByTestId("turn-status")).toContainText("胜者：对手");
  for (const cell of [35, 36, 37, 38]) {
    await expect(pageA.locator(`[data-cell-index="${cell}"]`)).toHaveAttribute(
      "data-disc",
      "RED",
    );
  }
  const roundOneReplayId = await assertCompletedReplay(roomCode, 1);
  const roundOneHistoryA = await readHistory(pageA);
  const roundOneHistoryB = await readHistory(pageB);
  expect(roundOneHistoryA).toEqual([
    expect.objectContaining({
      roundNumber: 1,
      gameId: "connect-four",
      gameVersion: "1.0.0",
      status: "completed",
      finalRevision: 7,
      playerSlotId: slotA,
      replayAvailable: true,
    }),
  ]);
  expect(roundOneHistoryB).toEqual([
    expect.objectContaining({
      matchId: roundOneHistoryA[0]?.matchId,
      roundNumber: 1,
      playerSlotId: slotB,
    }),
  ]);

  await Promise.all(
    [pageA, pageB].map((page) =>
      page.getByTestId("next-round-settings").click(),
    ),
  );
  await pageA.getByTestId("starter-owner").click();
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/2 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("room-code")).toHaveText(roomCode);
    }),
  );
  await expectRevision([pageA, pageB], 0);
  await expect(pageA.getByTestId("player-slot")).toHaveText(slotA);
  await expect(pageB.getByTestId("player-slot")).toHaveText(slotB);

  for (const [index, [actor, column]] of winningDrops.entries()) {
    await playAcceptedDrop(actor, [pageA, pageB], column, index + 1);
  }
  const roundTwoReplayId = await assertCompletedReplay(roomCode, 2);
  expect(roundTwoReplayId).not.toBe(roundOneReplayId);

  const [historyA, historyB] = await Promise.all([
    readHistory(pageA),
    readHistory(pageB),
  ]);
  expect(historyA).toHaveLength(2);
  expect(historyB).toHaveLength(2);
  expect(historyA.map((match) => match.roundNumber).sort()).toEqual([1, 2]);
  expect(new Set(historyA.map((match) => match.matchId)).size).toBe(2);
  expect(new Set(historyA.map((match) => match.matchId))).toEqual(
    new Set(historyB.map((match) => match.matchId)),
  );
  for (const match of historyA) {
    expect(match).toEqual({
      matchId: expect.any(String),
      roundNumber: expect.any(Number),
      gameId: "connect-four",
      gameVersion: "1.0.0",
      status: "completed",
      finalRevision: 7,
      playerSlotId: slotA,
      createdAt: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      replayAvailable: true,
    });
  }
  const serializedHistory = JSON.stringify([historyA, historyB]);
  for (const forbidden of [
    "playerSessionId",
    "userId",
    "runtimeRoomId",
    "initialConfig",
    "board",
    "acceptedActions",
    "recordedOutcome",
    "rngSeed",
    "authoritativeState",
  ]) {
    expect(serializedHistory).not.toContain(forbidden);
  }

  const unrelatedContext = await browser.newContext();
  const missingSession = await unrelatedContext.request.get(
    `${harness.webUrl}/api/matches`,
  );
  expect(missingSession.status()).toBe(401);
  const unrelatedPage = await unrelatedContext.newPage();
  await unrelatedPage.goto(`${harness.webUrl}/games`);
  const unrelatedHistory = await unrelatedPage.request.get(
    `${harness.webUrl}/api/matches?matchId=${String(historyA[0]?.matchId)}&playerSessionId=forged`,
  );
  await expect(unrelatedHistory.json()).resolves.toEqual({ matches: [] });
  await unrelatedContext.close();

  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});

test("the shared HUD cancels and confirms a Connect Four resignation once", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const resignedRoom = await startActiveRound(pageA, pageB);

  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("resign-game")).toBeVisible(),
    ),
  );
  const resignButton = pageB.getByTestId("resign-game");
  const canceledDialog = handleResignDialog(pageB, "dismiss");
  await resignButton.click();
  expect(await canceledDialog).toContain("投降后对手将立即获胜");
  await expectRevision([pageA, pageB], 0);
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局进行中"),
    ),
  );

  const acceptedDialog = handleResignDialog(pageB, "accept");
  await resignButton.click();
  expect(await acceptedDialog).toContain("投降后对手将立即获胜");
  await expectRevision([pageA, pageB], 1);
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );

  const room = await harness.gameServer.roomStore.getByRoomCode(
    resignedRoom.roomCode,
  );
  const round = room?.currentRound;
  if (round === null || round === undefined) {
    throw new Error(
      "The completed Connect Four resignation round was not stored.",
    );
  }
  expect(round).toMatchObject({
    revision: 1,
    status: "completed",
    outcome: {
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: resignedRoom.slotA,
      resignedSlotId: resignedRoom.slotB,
    },
  });
  const replay = await harness.gameServer.replayStore.get(round.replayId);
  expect(replay?.actions).toEqual([
    {
      sequence: 1,
      actorSlotId: resignedRoom.slotB,
      action: { type: "RESIGN" },
    },
  ]);
  expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
    status: "verified",
    outcome: {
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: resignedRoom.slotA,
      resignedSlotId: resignedRoom.slotB,
    },
  });

  await Promise.all([contextA.close(), contextB.close()]);
});
