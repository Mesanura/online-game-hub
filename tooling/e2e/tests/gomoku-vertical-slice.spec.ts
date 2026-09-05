import { expect, test } from "@playwright/test";
import type { FrameLocator, Page } from "@playwright/test";

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

function gomokuSurface(page: Page): FrameLocator {
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

async function playAcceptedStone(
  actor: Page,
  viewers: readonly Page[],
  cell: number,
  revision: number,
): Promise<void> {
  const button = gomokuSurface(actor).locator(`[data-cell-index="${cell}"]`);
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

async function expectDesktopBoardFits(page: Page): Promise<void> {
  const board = gomokuSurface(page).locator(".board");
  const surfaceFrame = page.getByTestId("game-surface-iframe");
  const stage = page.getByTestId("game-stage");
  await expect(board).toBeVisible();
  const [boardBox, frameBox, stageBox] = await Promise.all([
    board.boundingBox(),
    surfaceFrame.boundingBox(),
    stage.boundingBox(),
  ]);
  const viewport = page.viewportSize();
  if (
    boardBox === null ||
    frameBox === null ||
    stageBox === null ||
    viewport === null
  ) {
    throw new Error("The default Gomoku board is not inside the game stage.");
  }
  const pageSize = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(pageSize.scrollHeight).toBeLessThanOrEqual(pageSize.clientHeight);
  expect(boardBox.height).toBeGreaterThanOrEqual(viewport.height * 0.64);
  expect(boardBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(boardBox.y).toBeGreaterThanOrEqual(frameBox.y);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(
    frameBox.x + frameBox.width,
  );
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(
    frameBox.y + frameBox.height,
  );
  expect(frameBox.x).toBeGreaterThanOrEqual(stageBox.x);
  expect(frameBox.y).toBeGreaterThanOrEqual(stageBox.y);
  expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(
    stageBox.x + stageBox.width,
  );
  expect(frameBox.y + frameBox.height).toBeLessThanOrEqual(
    stageBox.y + stageBox.height,
  );
}

async function startActiveRound(
  pageA: Page,
  pageB: Page,
): Promise<{
  readonly roomCode: string;
  readonly slotA: string;
  readonly slotB: string;
}> {
  await pageA.goto(`${harness.webUrl}/games/gomoku`);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/gomoku/1.0.2/setup/index.html",
  );
  await gomokuSurface(pageA).getByRole("button", { name: "房主先手" }).click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Gomoku did not expose an invitation URL.");
  const roomCode = new URL(inviteUrl).pathname.split("/").at(-1) ?? "";

  await pageB.goto(inviteUrl);
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/gomoku/1.0.2/play/index.html",
      );
    }),
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Gomoku player is missing its stable slot.");
  }
  return { roomCode, slotA, slotB };
}

test("two accounts create, join, synchronize, and complete authoritative Gomoku", async ({
  browser,
}) => {
  const contextA = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 720 },
  });
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "gomoku_account_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "gomoku_account_b"),
  ]);
  const browserErrors: string[] = [];
  capturePageErrors(pageA, browserErrors);
  capturePageErrors(pageB, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const gomokuCard = pageA.getByRole("article").filter({ hasText: "五子棋" });
  await expect(gomokuCard).toContainText("2–2");
  await gomokuCard.getByRole("link", { name: "创建或加入房间" }).click();
  await expect(pageA).toHaveURL(/\/games\/gomoku$/u);
  await expect(pageA.getByRole("heading", { level: 1 })).toHaveText(
    "创建或加入房间",
  );
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
    "/game-surfaces/gomoku/1.0.2/setup/index.html",
  );
  await gomokuSurface(pageA).getByRole("button", { name: "房主先手" }).click();

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Gomoku did not expose an invitation URL.");
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/gomoku\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  const roomCode = invitation.pathname.split("/").at(-1) ?? "";

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
        "/game-surfaces/gomoku/1.0.2/play/index.html",
      );
      await expect(
        gomokuSurface(page).getByRole("grid", { name: "五子棋棋盘" }),
      ).toBeVisible();
      await expect(
        gomokuSurface(page).locator("[data-cell-index]"),
      ).toHaveCount(225);
    }),
  );
  await expect(gomokuSurface(pageA).getByTestId("player-stone")).toContainText(
    "你执黑棋",
  );
  await expect(gomokuSurface(pageB).getByTestId("player-stone")).toContainText(
    "你执白棋",
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Gomoku player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);

  const illegalCell = gomokuSurface(pageB).locator('[data-cell-index="105"]');
  await expect(illegalCell).toBeDisabled();
  await expectRevision([pageA, pageB], 0);
  const previewCell = gomokuSurface(pageA).locator('[data-cell-index="105"]');
  await expect(previewCell).toHaveAttribute("data-preview-stone", "BLACK");
  await previewCell.hover();
  await expect
    .poll(() =>
      previewCell.evaluate((cell) => {
        const stone = cell.querySelector("span");
        return stone === null ? null : getComputedStyle(stone).opacity;
      }),
    )
    .toBe("0.42");
  const previewStyle = await previewCell.evaluate((cell) => {
    const stone = cell.querySelector("span");
    const board = cell.closest(".board");
    if (stone === null || board === null) {
      throw new Error("Gomoku preview stone is missing.");
    }
    return {
      cursor: getComputedStyle(cell).cursor,
      borderColor: getComputedStyle(board).borderColor,
      backgroundImage: getComputedStyle(stone).backgroundImage,
      opacity: getComputedStyle(stone).opacity,
    };
  });
  expect(previewStyle).toMatchObject({
    cursor: "pointer",
    borderColor: "rgb(211, 154, 94)",
    opacity: "0.42",
  });
  expect(previewStyle.backgroundImage).toContain("radial-gradient");

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
  await expect(gomokuSurface(pageA).getByTestId("turn-status")).toHaveText(
    "你赢了",
  );
  await expect(gomokuSurface(pageB).getByTestId("turn-status")).toHaveText(
    "对手获胜",
  );
  for (const cell of [105, 106, 107, 108, 109]) {
    await expect(
      gomokuSurface(pageA).locator(`[data-cell-index="${cell}"]`),
    ).toHaveAttribute("data-stone", "BLACK");
  }
  await expect(gomokuSurface(pageA).locator(".board")).toHaveScreenshot(
    "gomoku-warm-clay-board.png",
    { animations: "disabled", maxDiffPixelRatio: 0.01 },
  );

  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null)
    throw new Error("The completed Gomoku room was not stored.");
  expect(room).toMatchObject({
    gameId: "gomoku",
    gameVersion: "1.1.0",
    initialConfig: { boardSize: 15, winLength: 5 },
    currentRound: { revision: 9, status: "completed" },
  });
  const currentRound = room.currentRound;
  if (currentRound === null) {
    throw new Error("The completed Gomoku round was not stored.");
  }
  const replay = await harness.gameServer.replayStore.get(
    currentRound.replayId,
  );
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
    ).get(currentRound.replayId);
    expect(rebuiltReplay?.header).toMatchObject({
      replayFormatVersion: 1,
      gameId: "gomoku",
      gameVersion: "1.1.0",
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
      gameVersion: "1.1.0",
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
    "/game-surfaces/gomoku/1.0.2/replay/index.html",
  );
  await expect(gomokuSurface(pageA).locator("[data-cell-index]")).toHaveCount(
    225,
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});

test("the shared HUD cancels and confirms a Gomoku resignation once", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageA.setViewportSize({ width: 1366, height: 768 });
  await pageB.setViewportSize({ width: 1440, height: 900 });
  const resignedRoom = await startActiveRound(pageA, pageB);

  await Promise.all([pageA, pageB].map((page) => expectDesktopBoardFits(page)));
  await pageA.setViewportSize({ width: 1920, height: 1080 });
  await expectDesktopBoardFits(pageA);

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
    throw new Error("The completed Gomoku resignation round was not stored.");
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
