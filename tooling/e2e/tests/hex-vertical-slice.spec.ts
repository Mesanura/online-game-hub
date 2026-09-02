import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { startE2eHarness } from "../src/harness.js";
import { registerE2eAccount } from "../src/account.js";
import type { E2eHarness } from "../src/harness.js";

const BLUE_WINNING_PATH = Array.from({ length: 11 }, (_, row) => row * 11);

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
  await expect(pageA.getByTestId("starter-random")).toHaveText("随机先手");
  await pageA.getByTestId("starter-owner").click();

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
      await expect(
        page.getByRole("grid", { name: "六贯棋棋盘" }),
      ).toBeVisible();
      await expect(page.locator("[data-cell-index]")).toHaveCount(121);
      await expect(page.locator(".hex-coordinate-upper-left")).toHaveCount(11);
      await expect(page.locator(".hex-coordinate-upper-right")).toHaveCount(11);
      await expect(page.locator(".hex-coordinate-lower-right")).toHaveCount(11);
      await expect(page.locator(".hex-coordinate-lower-left")).toHaveCount(11);
      await expect(page.locator(".hex-edge-band-blue")).toHaveCount(2);
      await expect(page.locator(".hex-edge-band-red")).toHaveCount(2);
      await expect(page.locator('[data-coordinate="K1"]')).toHaveCount(1);
      await expect(page.locator('[data-coordinate="K11"]')).toHaveCount(1);
      await expect(page.locator('[data-coordinate="A1"]')).toHaveCount(1);
      await expect(page.locator('[data-coordinate="A11"]')).toHaveCount(1);
      await expect(page.locator('[data-cell-index="1"]')).toHaveAttribute(
        "data-layout-x",
        "0.75",
      );
      await expect(page.locator('[data-cell-index="1"]')).toHaveAttribute(
        "data-layout-y",
        "0.5",
      );
      await expect(page.locator('[data-cell-index="11"]')).toHaveAttribute(
        "data-layout-x",
        "0.75",
      );
      await expect(page.locator('[data-cell-index="11"]')).toHaveAttribute(
        "data-layout-y",
        "-0.5",
      );
      const boardScroll = await page
        .locator(".hex-board-scroll")
        .evaluate((element) => ({
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
        }));
      expect(boardScroll.scrollHeight).toBeLessThanOrEqual(
        boardScroll.clientHeight + 1,
      );
      expect(boardScroll.scrollWidth).toBeLessThanOrEqual(
        boardScroll.clientWidth + 1,
      );
    }),
  );
  await expect(pageA.getByTestId("player-color")).toContainText("蓝方");
  await expect(pageB.getByTestId("player-color")).toContainText("红方");
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Hex player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);

  const illegalCell = pageB.locator('[data-cell-index="0"]');
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
      throw new Error("The Hex cell has no intent handler.");
    }
    props.onClick();
  });
  await expect(pageB.getByTestId("command-rejection")).toContainText(
    "还没有轮到你",
  );
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
  await expect(pageA.getByTestId("turn-status")).toContainText("胜者：你");
  await expect(pageB.getByTestId("turn-status")).toContainText("胜者：对手");
  await expect(pageA.getByTestId("rematch-game")).toHaveText("重新对局");
  await expect(pageA.getByTestId("next-round-settings")).toHaveText("设置规则");
  await expect(pageA.locator(".hex-cell.winning-cell")).toHaveCount(11);
  for (const cell of BLUE_WINNING_PATH) {
    await expect(pageA.locator(`[data-cell-index="${cell}"]`)).toHaveClass(
      /winning-cell/u,
    );
    await expect(pageA.locator(`[data-cell-index="${cell}"]`)).toHaveAttribute(
      "data-color",
      "BLUE",
    );
  }
  const winningHighlight = await pageA
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
    }),
  );
  await expectRevision([pageA, pageB], 0);
  await expect(pageA.getByTestId("player-color")).toContainText("蓝方");
  await expect(pageB.getByTestId("player-color")).toContainText("红方");
  await expect(pageA.getByTestId("player-slot")).toHaveText(slotA);
  await expect(pageB.getByTestId("player-slot")).toHaveText(slotB);

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
  await expect(pageA.getByTestId("turn-status")).toContainText("对手投降");
  await expect(pageB.getByTestId("turn-status")).toContainText("对手投降");
  await expect(pageA.locator(".hex-cell.winning-cell")).toHaveCount(0);
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

  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});
