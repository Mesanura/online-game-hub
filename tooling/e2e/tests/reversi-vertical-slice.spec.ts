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

function reversiSurface(page: Page): FrameLocator {
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

async function playAcceptedDisc(
  actor: Page,
  viewers: readonly Page[],
  cell: number,
  revision: number,
): Promise<void> {
  const button = reversiSurface(actor).locator(`[data-cell-index="${cell}"]`);
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

async function startActiveRound(
  pageA: Page,
  pageB: Page,
): Promise<{
  readonly roomCode: string;
  readonly slotA: string;
  readonly slotB: string;
}> {
  await pageA.goto(`${harness.webUrl}/games/reversi`);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/reversi/1.0.0/setup/index.html",
  );
  await reversiSurface(pageA).getByRole("button", { name: "房主先手" }).click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Reversi did not expose an invitation URL.");
  const roomCode = new URL(inviteUrl).pathname.split("/").at(-1) ?? "";

  await pageB.goto(inviteUrl);
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/reversi/1.0.0/play/index.html",
      );
    }),
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Reversi player is missing its stable slot.");
  }
  return { roomCode, slotA, slotB };
}

test("two accounts complete authoritative Reversi with flips and a non-full terminal board", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "reversi_account_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "reversi_account_b"),
  ]);
  const browserErrors: string[] = [];
  capturePageErrors(pageA, browserErrors);
  capturePageErrors(pageB, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const reversiCard = pageA.getByRole("article").filter({ hasText: "黑白棋" });
  await expect(reversiCard).toContainText("2–2");
  await expect(reversiCard).toContainText(
    "两名玩家轮流落子并翻转夹住的对方棋子，终局时棋子更多者获胜。",
  );
  await reversiCard.getByRole("link", { name: "创建或加入房间" }).click();
  await expect(pageA).toHaveURL(/\/games\/reversi$/u);
  await expect(pageA.getByRole("heading", { level: 1 })).toHaveText(
    "创建或加入房间",
  );
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("match-status")).toHaveCount(0);
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/reversi/1.0.0/setup/index.html",
  );
  await reversiSurface(pageA).getByRole("button", { name: "房主先手" }).click();

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) {
    throw new Error("Reversi did not expose an invitation URL.");
  }
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/reversi\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  const roomCode = invitation.pathname.split("/").at(-1);
  if (roomCode === undefined || roomCode.length === 0) {
    throw new Error("Reversi invitation omitted its room code.");
  }

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
        "/game-surfaces/reversi/1.0.0/play/index.html",
      );
      await expect(
        reversiSurface(page).getByRole("grid", { name: "黑白棋棋盘" }),
      ).toBeVisible();
      await expect(
        reversiSurface(page).locator("[data-cell-index]"),
      ).toHaveCount(64);
      await expect(
        reversiSurface(page).locator('[data-legal-move="true"]'),
      ).toHaveCount(4);
      await expect(
        reversiSurface(page).getByTestId("black-disc-count"),
      ).toHaveText("黑方：2");
      await expect(
        reversiSurface(page).getByTestId("white-disc-count"),
      ).toHaveText("白方：2");
    }),
  );
  await expect(reversiSurface(pageA).getByTestId("player-color")).toContainText(
    "黑方",
  );
  await expect(reversiSurface(pageB).getByTestId("player-color")).toContainText(
    "白方",
  );
  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected Reversi player is missing its stable slot.");
  }
  expect(slotA).not.toBe(slotB);

  const illegalCell = reversiSurface(pageB).locator('[data-cell-index="37"]');
  await expect(illegalCell).toBeDisabled();
  await expectRevision([pageA, pageB], 0);
  await expect(
    reversiSurface(pageA).locator('[data-cell-index="36"]'),
  ).toHaveAttribute("data-disc", "WHITE");
  await expect(
    reversiSurface(pageA).getByTestId("black-disc-count"),
  ).toHaveText("黑方：2");
  await expect(
    reversiSurface(pageA).getByTestId("white-disc-count"),
  ).toHaveText("白方：2");

  const placements = [
    [pageA, 37],
    [pageB, 29],
    [pageA, 21],
    [pageB, 30],
    [pageA, 23],
    [pageB, 44],
    [pageA, 19],
    [pageB, 45],
    [pageA, 53],
    [pageB, 34],
    [pageA, 33],
  ] as const;
  for (const [index, [actor, cell]] of placements.entries()) {
    await playAcceptedDisc(actor, [pageA, pageB], cell, index + 1);
    if (index === 0) {
      await expect(
        reversiSurface(pageA).locator('[data-cell-index="36"]'),
      ).toHaveAttribute("data-disc", "BLACK");
      await expect(
        reversiSurface(pageA).getByTestId("black-disc-count"),
      ).toHaveText("黑方：4");
      await expect(
        reversiSurface(pageA).getByTestId("white-disc-count"),
      ).toHaveText("白方：1");
    }
  }

  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("match-status")).toHaveText("对局已完成");
      await expect(
        reversiSurface(page).locator('[data-disc="BLACK"]'),
      ).toHaveCount(15);
      await expect(
        reversiSurface(page).locator('[data-disc="WHITE"]'),
      ).toHaveCount(0);
      await expect(
        reversiSurface(page).locator('[data-disc="EMPTY"]'),
      ).toHaveCount(49);
      await expect(
        reversiSurface(page).locator('[data-legal-move="true"]'),
      ).toHaveCount(0);
      await expect(
        reversiSurface(page).getByTestId("black-disc-count"),
      ).toHaveText("黑方：15");
      await expect(
        reversiSurface(page).getByTestId("white-disc-count"),
      ).toHaveText("白方：0");
    }),
  );
  await expect(reversiSurface(pageA).getByTestId("turn-status")).toContainText(
    "胜者：你",
  );
  await expect(reversiSurface(pageB).getByTestId("turn-status")).toContainText(
    "胜者：对手",
  );

  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null) {
    throw new Error("The completed Reversi room was not stored.");
  }
  expect(room).toMatchObject({
    gameId: "reversi",
    gameVersion: "1.1.0",
    setupProtocol: 6,
    initialConfig: null,
    currentRound: { roundNumber: 1, revision: 11, status: "completed" },
    players: [{ slotId: slotA }, { slotId: slotB }],
  });
  const currentRound = room.currentRound;
  if (currentRound === null) {
    throw new Error("The completed Reversi round was not stored.");
  }
  const replay = await harness.gameServer.replayStore.get(
    currentRound.replayId,
  );
  expect(replay?.actions).toHaveLength(11);
  expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
    status: "verified",
    rng: { cursor: 0 },
    outcome: {
      type: "WIN",
      winnerSlotId: slotA,
      discCounts: { BLACK: 15, WHITE: 0 },
    },
  });

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "reversi-e2e-replay",
    maxConnections: 2,
  });
  try {
    const rebuiltReplay = await new PostgresReplayStore(
      rebuiltClient.database,
    ).get(currentRound.replayId);
    expect(rebuiltReplay?.header).toMatchObject({
      replayFormatVersion: 1,
      gameId: "reversi",
      gameVersion: "1.1.0",
      initialConfig: null,
    });
    expect(rebuiltReplay?.actions).toHaveLength(11);
    expect(verifyReplay(rebuiltReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: slotA,
        discCounts: { BLACK: 15, WHITE: 0 },
      },
    });
  } finally {
    await rebuiltClient.close();
  }

  const [historyA, historyB] = await Promise.all([
    readHistory(pageA),
    readHistory(pageB),
  ]);
  expect(historyA).toHaveLength(1);
  expect(historyB).toHaveLength(1);
  const safeMetadataKeys = [
    "createdAt",
    "finalRevision",
    "finishedAt",
    "gameId",
    "gameVersion",
    "matchId",
    "playerSlotId",
    "replayAvailable",
    "roundNumber",
    "startedAt",
    "status",
  ];
  expect(Object.keys(historyA[0] ?? {}).sort()).toEqual(safeMetadataKeys);
  expect(Object.keys(historyB[0] ?? {}).sort()).toEqual(safeMetadataKeys);
  expect(historyA[0]).toMatchObject({
    gameId: "reversi",
    gameVersion: "1.1.0",
    status: "completed",
    finalRevision: 11,
    playerSlotId: slotA,
    replayAvailable: true,
  });
  expect(historyB[0]).toMatchObject({
    matchId: historyA[0]?.matchId,
    playerSlotId: slotB,
  });
  for (const match of [...historyA, ...historyB]) {
    expect(match).not.toHaveProperty("action");
    expect(match).not.toHaveProperty("actions");
    expect(match).not.toHaveProperty("initialConfig");
    expect(match).not.toHaveProperty("outcome");
    expect(match).not.toHaveProperty("rng");
    expect(match).not.toHaveProperty("seed");
  }

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
    "/game-surfaces/reversi/1.0.0/replay/index.html",
  );
  await expect(reversiSurface(pageA).locator("[data-cell-index]")).toHaveCount(
    64,
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});

test("the shared HUD cancels and confirms a Reversi resignation once", async ({
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
    throw new Error("The completed Reversi resignation round was not stored.");
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

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "reversi-resignation-e2e-replay",
    maxConnections: 2,
  });
  try {
    const rebuiltReplay = await new PostgresReplayStore(
      rebuiltClient.database,
    ).get(round.replayId);
    expect(rebuiltReplay?.header).toMatchObject({
      replayFormatVersion: 1,
      gameId: "reversi",
      gameVersion: "1.1.0",
      initialConfig: null,
    });
    expect(rebuiltReplay?.actions).toEqual([
      {
        sequence: 1,
        actorSlotId: resignedRoom.slotB,
        action: { type: "RESIGN" },
      },
    ]);
    expect(verifyReplay(rebuiltReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      outcome: {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: resignedRoom.slotA,
        resignedSlotId: resignedRoom.slotB,
      },
    });
  } finally {
    await rebuiltClient.close();
  }

  await Promise.all([contextA.close(), contextB.close()]);
});
