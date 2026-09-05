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

const BLUE_WINNING_PATH = Array.from({ length: 11 }, (_, row) => row * 11);

let harness: E2eHarness;

function hexSurface(page: Page): FrameLocator {
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
      if (dialog.type() !== "confirm") {
        reject(new Error(`Unexpected ${dialog.type()} dialog.`));
        return;
      }
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
  const button = hexSurface(actor).locator(`[data-cell-index="${cell}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await expectRevision(viewers, revision);
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

async function currentCompletedReplay(
  roomCode: string,
  roundNumber: number,
  revision: number,
  reason: "CONNECTION" | "RESIGNATION",
): Promise<string> {
  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null) throw new Error("The completed Hex room was not stored.");
  expect(room).toMatchObject({
    gameId: "hex",
    gameVersion: "1.0.0",
    setupProtocol: 6,
    initialConfig: null,
    currentRound: { roundNumber, revision, status: "completed" },
    players: [{ slotId: "slot-1" }, { slotId: "slot-2" }],
  });
  const currentRound = room.currentRound;
  if (currentRound === null) {
    throw new Error("The completed Hex round was not stored.");
  }
  const replay = await harness.gameServer.replayStore.get(
    currentRound.replayId,
  );
  expect(replay?.actions).toHaveLength(revision);
  expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
    status: "verified",
    rng: { cursor: 0 },
    outcome: { type: "WIN", reason, winnerSlotId: "slot-1" },
  });
  return currentRound.replayId;
}

test("two accounts complete Hex by connection, then use the shared HUD to cancel and confirm an off-turn resignation", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "hex_account_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "hex_account_b"),
  ]);
  const browserErrors: string[] = [];
  capturePageErrors(pageA, browserErrors);
  capturePageErrors(pageB, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const hexCard = pageA.getByRole("article").filter({ hasText: "六贯棋" });
  await expect(hexCard).toContainText("2–2");
  await expect(hexCard).toContainText(
    "两名玩家轮流在六边形格落子，率先用己方棋子连接对应两条边者获胜。",
  );
  await hexCard.getByRole("link", { name: "创建或加入房间" }).click();
  await expect(pageA).toHaveURL(/\/games\/hex$/u);
  await expect(pageA.getByRole("heading", { level: 1 })).toHaveText(
    "创建或加入房间",
  );
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("match-status")).toHaveCount(0);
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/hex/1.0.0/setup/index.html",
  );
  await hexSurface(pageA).getByRole("button", { name: "房主先手" }).click();

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Hex did not expose an invitation URL.");
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/hex\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
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
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("room-code")).toHaveText(roomCode);
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/hex/1.0.0/play/index.html",
      );
      await expect(
        hexSurface(page).getByRole("grid", { name: "六贯棋棋盘" }),
      ).toBeVisible();
      const surface = hexSurface(page);
      await expect(surface.locator("[data-cell-index]")).toHaveCount(121);
      await expect(surface.locator(".hex-coordinate-upper-left")).toHaveCount(
        11,
      );
      await expect(surface.locator(".hex-coordinate-upper-right")).toHaveCount(
        11,
      );
      await expect(surface.locator(".hex-coordinate-lower-right")).toHaveCount(
        11,
      );
      await expect(surface.locator(".hex-coordinate-lower-left")).toHaveCount(
        11,
      );
      await expect(surface.locator(".hex-edge-band-blue")).toHaveCount(2);
      await expect(surface.locator(".hex-edge-band-red")).toHaveCount(2);
      await expect(surface.locator('[data-coordinate="K1"]')).toHaveCount(1);
      await expect(surface.locator('[data-coordinate="K11"]')).toHaveCount(1);
      await expect(surface.locator('[data-coordinate="A1"]')).toHaveCount(1);
      await expect(surface.locator('[data-coordinate="A11"]')).toHaveCount(1);
      await expect(surface.locator('[data-cell-index="1"]')).toHaveAttribute(
        "data-layout-x",
        "0.75",
      );
      await expect(surface.locator('[data-cell-index="1"]')).toHaveAttribute(
        "data-layout-y",
        "0.5",
      );
      await expect(surface.locator('[data-cell-index="11"]')).toHaveAttribute(
        "data-layout-x",
        "0.75",
      );
      await expect(surface.locator('[data-cell-index="11"]')).toHaveAttribute(
        "data-layout-y",
        "-0.5",
      );
      const boardShell = await surface
        .locator(".board-shell")
        .evaluate((element) => ({
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
        }));
      expect(boardShell.scrollHeight).toBeLessThanOrEqual(
        boardShell.clientHeight + 1,
      );
      expect(boardShell.scrollWidth).toBeLessThanOrEqual(
        boardShell.clientWidth + 1,
      );
    }),
  );
  await expect(hexSurface(pageA).getByTestId("player-color")).toContainText(
    "蓝方",
  );
  await expect(hexSurface(pageB).getByTestId("player-color")).toContainText(
    "红方",
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Hex player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);

  const illegalCell = hexSurface(pageB).locator('[data-cell-index="0"]');
  await expect(illegalCell).toBeDisabled();
  await expectRevision([pageA, pageB], 0);

  const placements = [
    [pageA, 0],
    [pageB, 1],
    [pageA, 11],
    [pageB, 2],
    [pageA, 22],
    [pageB, 3],
    [pageA, 33],
    [pageB, 4],
    [pageA, 44],
    [pageB, 5],
    [pageA, 55],
    [pageB, 6],
    [pageA, 66],
    [pageB, 7],
    [pageA, 77],
    [pageB, 8],
    [pageA, 88],
    [pageB, 9],
    [pageA, 99],
    [pageB, 10],
    [pageA, 110],
  ] as const;
  for (const [index, [actor, cell]] of placements.entries()) {
    await playAcceptedStone(actor, [pageA, pageB], cell, index + 1);
  }
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  await expect(hexSurface(pageA).getByTestId("turn-status")).toContainText(
    "胜者：你",
  );
  await expect(hexSurface(pageB).getByTestId("turn-status")).toContainText(
    "胜者：对手",
  );
  await openGameHud(pageA);
  await expect(pageA.getByTestId("rematch-game")).toHaveText("重新对局");
  await expect(pageA.getByTestId("next-round-settings")).toHaveText("调整设置");
  await expect(hexSurface(pageA).locator(".hex-cell.winning-cell")).toHaveCount(
    11,
  );
  for (const cell of BLUE_WINNING_PATH) {
    await expect(
      hexSurface(pageA).locator(`[data-cell-index="${cell}"]`),
    ).toHaveClass(/winning-cell/u);
    await expect(
      hexSurface(pageA).locator(`[data-cell-index="${cell}"]`),
    ).toHaveAttribute("data-color", "BLUE");
  }
  const winningHighlight = await hexSurface(pageA)
    .locator(".hex-cell.winning-cell .hex-piece")
    .first()
    .evaluate((element) => {
      const highlight = getComputedStyle(element, "::after");
      return {
        boxShadow: highlight.boxShadow,
        filter: highlight.filter,
        opacity: highlight.opacity,
      };
    });
  expect(winningHighlight.filter).toContain("blur");
  expect(winningHighlight.boxShadow).toContain("rgba");
  expect(winningHighlight.opacity).toBe("1");
  const roundOneReplayId = await currentCompletedReplay(
    roomCode,
    1,
    21,
    "CONNECTION",
  );

  const rematchSetupRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  expect(rematchSetupRoom?.nextRoundSetup).toMatchObject({
    setupState: {
      starter: "FIXED",
      fixedStarterSlotId: slotA,
    },
    setupRevision: 0,
    readySlotIds: [],
    finalizedSetup: null,
  });

  await Promise.all([pageA, pageB].map((page) => openGameHud(page)));
  await pageA.getByTestId("rematch-game").click();
  await expect
    .poll(async () => {
      const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
      return room?.nextRoundSetup;
    })
    .toMatchObject({
      setupState: {
        starter: "FIXED",
        fixedStarterSlotId: slotA,
      },
      setupRevision: 0,
      readySlotIds: [slotA],
      finalizedSetup: null,
    });
  await pageB.getByTestId("rematch-game").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/hex/1.0.0/play/index.html",
      );
    }),
  );
  await expectRevision([pageA, pageB], 0);
  await expect(hexSurface(pageA).getByTestId("player-color")).toContainText(
    "蓝方",
  );
  await expect(hexSurface(pageB).getByTestId("player-color")).toContainText(
    "红方",
  );
  await expect(pageA.getByTestId("player-slot")).toHaveText(slotA);
  await expect(pageB.getByTestId("player-slot")).toHaveText(slotB);
  const roundTwoRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  expect(roundTwoRoom?.previousFinalizedSetup).toEqual({
    config: null,
    participantSlotIds: [slotA, slotB],
    playerOrder: [slotA, slotB],
    assignments: [
      { slotId: slotA, assignment: null },
      { slotId: slotB, assignment: null },
    ],
  });

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
  await expect(hexSurface(pageA).getByTestId("turn-status")).toContainText(
    "对手投降",
  );
  await expect(hexSurface(pageB).getByTestId("turn-status")).toContainText(
    "对手投降",
  );
  await expect(hexSurface(pageA).locator(".hex-cell.winning-cell")).toHaveCount(
    0,
  );
  const roundTwoReplayId = await currentCompletedReplay(
    roomCode,
    2,
    1,
    "RESIGNATION",
  );
  expect(roundTwoReplayId).not.toBe(roundOneReplayId);

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "hex-e2e-replays",
    maxConnections: 2,
  });
  try {
    const replayStore = new PostgresReplayStore(rebuiltClient.database);
    const [roundOneReplay, roundTwoReplay] = await Promise.all([
      replayStore.get(roundOneReplayId),
      replayStore.get(roundTwoReplayId),
    ]);
    expect(roundOneReplay?.actions).toHaveLength(21);
    expect(roundTwoReplay?.actions).toEqual([
      {
        sequence: 1,
        actorSlotId: slotB,
        action: { type: "RESIGN" },
      },
    ]);
    expect(verifyReplay(roundOneReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      outcome: { reason: "CONNECTION", winningPath: BLUE_WINNING_PATH },
    });
    expect(verifyReplay(roundTwoReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      outcome: {
        reason: "RESIGNATION",
        winnerSlotId: slotA,
        resignedSlotId: slotB,
      },
    });
  } finally {
    await rebuiltClient.close();
  }

  const [historyA, historyB] = await Promise.all([
    readHistory(pageA),
    readHistory(pageB),
  ]);
  expect(historyA).toHaveLength(2);
  expect(historyB).toHaveLength(2);
  expect(historyA.map((match) => match.roundNumber).sort()).toEqual([1, 2]);
  expect(historyA.map((match) => match.finalRevision).sort()).toEqual([1, 21]);
  expect(new Set(historyA.map((match) => match.matchId))).toEqual(
    new Set(historyB.map((match) => match.matchId)),
  );
  for (const match of historyA) {
    expect(match).toMatchObject({
      gameId: "hex",
      gameVersion: "1.0.0",
      status: "completed",
      playerSlotId: slotA,
      replayAvailable: true,
    });
  }

  await openGameHud(pageA);
  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  const replayMatchId = String(
    historyA.find((match) => match.roundNumber === 1)?.matchId,
  );
  await pageA.goto(
    `${harness.webUrl}/account/matches/${encodeURIComponent(replayMatchId)}/replay`,
  );
  await expect(pageA.getByTestId("replay-page")).toBeVisible();
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/hex/1.0.0/replay/index.html",
  );
  await expect(hexSurface(pageA).locator("[data-cell-index]")).toHaveCount(121);
  await expect(pageA.getByTestId("replay-frame-count")).toHaveText("1 / 22");
  await expect(hexSurface(pageA).locator('[data-color="EMPTY"]')).toHaveCount(
    121,
  );
  await pageA.getByTestId("replay-last").click();
  await expect(pageA.getByTestId("replay-frame-count")).toHaveText("22 / 22");
  await expect(hexSurface(pageA).locator(".hex-cell.winning-cell")).toHaveCount(
    11,
  );
  await expect(hexSurface(pageA).getByTestId("turn-status")).toContainText(
    "已连通对应两边",
  );
  await expect(
    hexSurface(pageA).locator("[data-cell-index]:not(:disabled)"),
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});
