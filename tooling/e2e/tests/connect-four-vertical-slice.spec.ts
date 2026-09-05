import { expect, test } from "@playwright/test";
import type { BrowserContext, FrameLocator, Page } from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { openGameHud } from "../src/game-hud.js";
import { startE2eHarness } from "../src/harness.js";
import { registerE2eAccount } from "../src/account.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

function connectFourSurface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

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
  const button = connectFourSurface(actor).locator(`[data-column="${column}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await expectRevision(viewers, revision);
}

async function expectResponsiveConnectFourBoard(page: Page): Promise<void> {
  for (const viewport of [
    { width: 2560, height: 1440 },
    { width: 1707, height: 960 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => {
        const [geometry, pageFits] = await Promise.all([
          connectFourSurface(page)
            .locator(".board")
            .evaluate((board) => {
              const wrap = board.closest<HTMLElement>(".board-wrap");
              const layout = board.closest<HTMLElement>(".board-layout");
              if (wrap === null || layout === null) return null;
              const controls =
                layout.querySelector<HTMLElement>(".column-controls");
              const cells = Array.from(
                board.querySelectorAll<HTMLElement>(".board-cell"),
                (cell) => cell.getBoundingClientRect(),
              );
              if (controls === null) return null;
              const boardRect = board.getBoundingClientRect();
              const wrapRect = wrap.getBoundingClientRect();
              const layoutRect = layout.getBoundingClientRect();
              const controlsRect = controls.getBoundingClientRect();
              return {
                board: {
                  width: boardRect.width,
                  height: boardRect.height,
                  top: boardRect.top,
                  bottom: boardRect.bottom,
                },
                wrap: {
                  width: wrapRect.width,
                  height: wrapRect.height,
                  left: wrapRect.left,
                  top: wrapRect.top,
                  right: wrapRect.right,
                  bottom: wrapRect.bottom,
                },
                layout: {
                  left: layoutRect.left,
                  top: layoutRect.top,
                  right: layoutRect.right,
                  bottom: layoutRect.bottom,
                },
                controlsBottom: controlsRect.bottom,
                cellWidths: cells.map((cell) => cell.width),
                cellHeights: cells.map((cell) => cell.height),
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
        if (geometry === null || geometry.cellWidths.length !== 42)
          return false;
        const minCellWidth = Math.min(...geometry.cellWidths);
        const maxCellWidth = Math.max(...geometry.cellWidths);
        const minCellHeight = Math.min(...geometry.cellHeights);
        const maxCellHeight = Math.max(...geometry.cellHeights);
        return (
          geometry.board.width > 0 &&
          geometry.board.height > 0 &&
          Math.abs(geometry.board.width / geometry.board.height - 7 / 6) <
            0.01 &&
          geometry.layout.left >= geometry.wrap.left - 1 &&
          geometry.layout.top >= geometry.wrap.top - 1 &&
          geometry.layout.right <= geometry.wrap.right + 1 &&
          geometry.layout.bottom <= geometry.wrap.bottom + 1 &&
          geometry.controlsBottom <= geometry.board.top + 1 &&
          maxCellWidth - minCellWidth <= 1 &&
          maxCellHeight - minCellHeight <= 1 &&
          pageFits
        );
      })
      .toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
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
    gameVersion: "1.1.0",
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
      gameVersion: "1.1.0",
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
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/connect-four/1.0.3/setup/index.html",
  );
  await connectFourSurface(pageA)
    .getByRole("button", { name: "房主先手" })
    .click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Connect Four did not expose an invitation URL.");
  const roomCode = new URL(inviteUrl).pathname.split("/").at(-1) ?? "";

  await pageB.goto(inviteUrl);
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/connect-four/1.0.3/play/index.html",
      );
    }),
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

test("two accounts play two authoritative Connect Four rounds with independent replay and private history", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "connect_four_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "connect_four_b"),
  ]);
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
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/connect-four/1.0.3/setup/index.html",
  );
  await connectFourSurface(pageA)
    .getByRole("button", { name: "房主先手" })
    .click();

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
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/connect-four/1.0.3/play/index.html",
      );
      await expect(
        connectFourSurface(page).locator("[data-column]"),
      ).toHaveCount(7);
      await expect(
        connectFourSurface(page).locator("[data-cell-index]"),
      ).toHaveCount(42);
    }),
  );
  await assertIsolatedGuestCookies(contextA, contextB);
  await expect(
    connectFourSurface(pageA).getByTestId("player-disc"),
  ).toContainText("红");
  await expect(
    connectFourSurface(pageB).getByTestId("player-disc"),
  ).toContainText("黄");
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);
  await expectResponsiveConnectFourBoard(pageA);

  const illegalColumn = connectFourSurface(pageB).locator('[data-column="0"]');
  await expect(illegalColumn).toBeDisabled();
  await expectRevision([pageA, pageB], 0);
  await expect(
    connectFourSurface(pageA).locator('[data-cell-index="35"]'),
  ).toHaveAttribute("data-disc", "EMPTY");

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
  await expect(
    connectFourSurface(pageA).getByTestId("turn-status"),
  ).toContainText("你赢了");
  await expect(
    connectFourSurface(pageB).getByTestId("turn-status"),
  ).toContainText("对手获胜");
  for (const cell of [35, 36, 37, 38]) {
    await expect(
      connectFourSurface(pageA).locator(`[data-cell-index="${cell}"]`),
    ).toHaveAttribute("data-disc", "RED");
  }
  const roundOneReplayId = await assertCompletedReplay(roomCode, 1);
  const roundOneHistoryA = await readHistory(pageA);
  const roundOneHistoryB = await readHistory(pageB);
  expect(roundOneHistoryA).toEqual([
    expect.objectContaining({
      roundNumber: 1,
      gameId: "connect-four",
      gameVersion: "1.1.0",
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
  await expect(
    connectFourSurface(pageA).getByText("沿用上一局的实际棋色与顺序"),
  ).toBeVisible();
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
      gameVersion: "1.1.0",
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
  expect(unrelatedHistory.status()).toBe(401);
  await expect(unrelatedHistory.json()).resolves.toEqual({
    code: "ACCOUNT_SESSION_REQUIRED",
  });
  await unrelatedContext.close();

  await openGameHud(pageA);
  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  const replayMatchId = String(historyA[0]?.matchId);
  await pageA.goto(
    `${harness.webUrl}/account/matches/${encodeURIComponent(replayMatchId)}/replay`,
  );
  await expect(pageA.getByTestId("replay-page")).toBeVisible();
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/connect-four/1.0.3/replay/index.html",
  );
  await expect(
    connectFourSurface(pageA).locator("[data-cell-index]"),
  ).toHaveCount(42);
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

  await Promise.all([pageA, pageB].map((page) => openGameHud(page)));
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("resign-game")).toBeVisible(),
    ),
  );
  const resignButton = pageB.getByTestId("resign-game");
  const canceledDialog = handleResignDialog(pageB, "dismiss");
  await resignButton.click();
  expect(await canceledDialog).toContain("排在未投降玩家之后");
  await expectRevision([pageA, pageB], 0);
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局进行中"),
    ),
  );

  const acceptedDialog = handleResignDialog(pageB, "accept");
  await resignButton.click();
  expect(await acceptedDialog).toContain("排在未投降玩家之后");
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
