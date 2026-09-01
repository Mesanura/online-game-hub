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
  await pageA.getByTestId("starter-owner").click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Gomoku did not expose an invitation URL.");
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
    throw new Error("A connected Gomoku player is missing its stable slot.");
  }
  return { roomCode, slotA, slotB };
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
  await pageA.getByTestId("starter-owner").click();

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
      await expect(
        page.getByRole("grid", { name: "五子棋棋盘" }),
      ).toBeVisible();
      await expect(page.locator("[data-cell-index]")).toHaveCount(225);
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

  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
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

  await Promise.all(
    [pageA, pageB].map(async (page) => {
      const boardScroll = page.locator(".gomoku-board-scroll");
      const board = page.locator(".gomoku-board");
      const stage = page.getByTestId("game-stage");
      await expect(boardScroll).toBeVisible();
      await expect(board).toBeVisible();
      const scrollSize = await boardScroll.evaluate((element) => ({
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
      }));
      expect(scrollSize.scrollWidth).toBeLessThanOrEqual(
        scrollSize.clientWidth,
      );
      expect(scrollSize.scrollHeight).toBeLessThanOrEqual(
        scrollSize.clientHeight,
      );
      const [boardBox, stageBox] = await Promise.all([
        board.boundingBox(),
        stage.boundingBox(),
      ]);
      if (boardBox === null || stageBox === null) {
        throw new Error(
          "The default Gomoku board is not inside the game stage.",
        );
      }
      expect(boardBox.x).toBeGreaterThanOrEqual(stageBox.x);
      expect(boardBox.y).toBeGreaterThanOrEqual(stageBox.y);
      expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(
        stageBox.x + stageBox.width,
      );
      expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(
        stageBox.y + stageBox.height,
      );
    }),
  );

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
