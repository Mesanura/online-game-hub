import { expect, test } from "@playwright/test";
import type { FrameLocator, Page } from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { registerE2eAccount } from "../src/account.js";
import { closeGameHud, openGameHud } from "../src/game-hud.js";
import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

function chineseCheckersSurface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

async function expectSetupIntentSettled(surface: FrameLocator): Promise<void> {
  await expect(surface.locator(".surface-meta")).not.toContainText(
    "正在确认操作…",
  );
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

function acceptResignation(page: Page): Promise<string> {
  return new Promise((resolve, reject) => {
    page.once("dialog", (dialog) => {
      if (dialog.type() !== "confirm") {
        reject(new Error(`Unexpected ${dialog.type()} dialog.`));
        return;
      }
      const message = dialog.message();
      void dialog.accept().then(() => resolve(message), reject);
    });
    void page.getByTestId("resign-game").click();
  });
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

test("three accounts configure camps in the independent Surface, rematch with complete settings, and replay both rankings", async ({
  browser,
}) => {
  const contextA = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 720 },
  });
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const pages = [pageA, pageB, pageC] as const;
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "cc_account_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "cc_account_b"),
    registerE2eAccount(pageC.request, harness.webUrl, "cc_account_c"),
  ]);
  const browserErrors: string[] = [];
  for (const page of pages) capturePageErrors(page, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const gameCard = pageA.getByRole("article").filter({ hasText: "中国跳棋" });
  await expect(gameCard).toContainText("2–6");
  await gameCard.getByRole("link", { name: "创建或加入房间" }).click();
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("match-status")).toHaveCount(0);
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/chinese-checkers/1.0.2/setup/index.html",
  );

  const setupA = chineseCheckersSurface(pageA);
  await setupA.locator("[data-player-count]").selectOption("3");
  await expect(setupA.getByTestId("setup-status")).toContainText(
    "等待 3 位玩家",
  );
  await expectSetupIntentSettled(setupA);
  await setupA.locator('[data-camp-option="N"]').click();
  await expectSetupIntentSettled(setupA);
  await setupA.locator('[data-starter="OWNER"]').click();
  await expectSetupIntentSettled(setupA);

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) {
    throw new Error("Chinese Checkers did not expose an invitation URL.");
  }
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/chinese-checkers\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  const roomCode = invitation.pathname.split("/").at(-1);
  if (roomCode === undefined || roomCode.length === 0) {
    throw new Error("Chinese Checkers invitation omitted its room code.");
  }

  await Promise.all([pageB.goto(inviteUrl), pageC.goto(inviteUrl)]);
  await Promise.all(
    [pageB, pageC].map((page) =>
      expect(page.getByTestId("connection-state")).toHaveText("已连接"),
    ),
  );
  const setupB = chineseCheckersSurface(pageB);
  const setupC = chineseCheckersSurface(pageC);
  await setupB.locator('[data-camp-option="S"]').click();
  await expectSetupIntentSettled(setupB);
  await setupC.locator('[data-camp-option="NE"]').click();
  await expectSetupIntentSettled(setupC);
  await expect(setupA.getByTestId("setup-status")).toHaveText(
    "设置完成，所有参与者可以分别准备",
  );

  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  const slotC = (await pageC.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined || slotC === undefined) {
    throw new Error("A connected Chinese Checkers player is missing a slot.");
  }
  expect(new Set([slotA, slotB, slotC]).size).toBe(3);
  const setupAssignmentsByStableSlot = [
    { slotId: slotA, camp: "N" },
    { slotId: slotB, camp: "S" },
    { slotId: slotC, camp: "NE" },
  ].sort((left, right) => left.slotId.localeCompare(right.slotId));

  const waitingRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  expect(waitingRoom).toMatchObject({
    gameId: "chinese-checkers",
    gameVersion: "1.0.0",
    setupProtocol: 6,
    nextRoundSetup: {
      setupState: {
        targetPlayerCount: 3,
        starter: "OWNER",
        fixedStarterSlotId: null,
        assignments: setupAssignmentsByStableSlot,
      },
      readySlotIds: [],
      finalizedSetup: null,
    },
  });

  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/3 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await expect(pageC.getByTestId("round-setup-status")).toHaveText(
    "2/3 人已准备",
  );
  await pageC.getByTestId("toggle-round-ready").click();

  for (const page of pages) {
    await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
    await expect(page.getByTestId("room-code")).toHaveText(roomCode);
    await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
      "src",
      "/game-surfaces/chinese-checkers/1.0.2/play/index.html",
    );
    const surface = chineseCheckersSurface(page);
    await expect(
      surface.getByRole("grid", { name: "中国跳棋六芒星棋盘" }),
    ).toBeVisible();
    await expect(surface.locator("[data-cell-index]")).toHaveCount(73);
    await expect(surface.locator('[data-occupied="true"]')).toHaveCount(18);
    await expect(
      surface.locator('[data-cell-index][data-camp="CENTER"]'),
    ).toHaveCount(37);
    for (const camp of ["N", "NE", "SE", "S", "SW", "NW"] as const) {
      await expect(
        surface.locator(`[data-cell-index][data-camp="${camp}"]`),
      ).toHaveCount(6);
    }
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
  }
  await expect(
    chineseCheckersSurface(pageA).getByTestId("player-camp"),
  ).toContainText("北营地");
  await expect(
    chineseCheckersSurface(pageB).getByTestId("player-camp"),
  ).toContainText("南营地");
  await expect(
    chineseCheckersSurface(pageC).getByTestId("player-camp"),
  ).toContainText("东北营地");
  await expect(
    chineseCheckersSurface(pageB).locator("[data-cell-index]:not(:disabled)"),
  ).toHaveCount(0);
  await pageA.setViewportSize({ width: 1280, height: 800 });
  const visualBoard = chineseCheckersSurface(pageA).locator(
    ".chinese-checkers-board",
  );
  await visualBoard.evaluate((board) => {
    const style = (board as HTMLElement).style;
    style.setProperty("width", "433px", "important");
    style.setProperty("height", "500px", "important");
  });
  await expect(visualBoard).toHaveScreenshot(
    "chinese-checkers-six-point-board.png",
    {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  );

  const source = chineseCheckersSurface(pageA)
    .locator('[data-legal-source="true"]')
    .first();
  await expect(source).toBeEnabled();
  await source.click();
  const target = chineseCheckersSurface(pageA)
    .locator(".is-legal-target:not(:disabled)")
    .first();
  await expect(target).toBeVisible();
  const targetCell = await target.getAttribute("data-cell-index");
  if (targetCell === null)
    throw new Error("Move target omitted its cell index.");
  await target.click();
  await expectRevision(pages, 1);
  const movedPiece = chineseCheckersSurface(pageA).locator(
    `[data-cell-index="${targetCell}"]`,
  );
  await expect(movedPiece).toHaveAttribute("data-piece-camp", "N");
  await expect(movedPiece.locator(".chinese-checkers-piece")).toHaveCSS(
    "background-color",
    "rgb(233, 111, 106)",
  );

  await Promise.all([pageB, pageC].map((page) => openGameHud(page)));
  expect(await acceptResignation(pageB)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 2);
  expect(await acceptResignation(pageC)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 3);
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  const firstRanking = chineseCheckersSurface(pageA)
    .getByRole("list", { name: "最终排名" })
    .getByRole("listitem")
    .first();
  await expect(firstRanking).toContainText("第 1 名");
  await expect(firstRanking).toContainText(slotA);

  const roundOneRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  const roundOne = roundOneRoom?.currentRound;
  if (roundOne === null || roundOne === undefined) {
    throw new Error("The first Chinese Checkers round was not archived.");
  }
  expect(roundOneRoom).toMatchObject({
    setupProtocol: 6,
    currentRound: { roundNumber: 1, revision: 3, status: "completed" },
    nextRoundSetup: {
      setupState: {
        targetPlayerCount: 3,
        starter: "FIXED",
        fixedStarterSlotId: slotA,
        assignments: setupAssignmentsByStableSlot,
      },
      setupRevision: 0,
      readySlotIds: [],
      finalizedSetup: null,
    },
  });
  const roundOneReplayId = roundOne.replayId;

  await expect(pageA.getByTestId("game-result-hud")).toContainText(
    "你获得第 1 名",
  );
  await Promise.all([pageB, pageC].map((page) => closeGameHud(page)));
  await pageA.getByTestId("rematch-game").click();
  await expect(pageA.getByTestId("rematch-game")).toHaveText(
    "等待其余 2 名玩家确认",
  );
  await expect
    .poll(async () => {
      const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
      return room?.nextRoundSetup?.readySlotIds;
    })
    .toEqual([slotA]);
  await pageB.getByTestId("rematch-game").click();
  await expect(pageA.getByTestId("rematch-game")).toHaveText(
    "等待其余 1 名玩家确认",
  );
  await pageC.getByTestId("rematch-game").click();

  await Promise.all(
    pages.map(async (page) => {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("revision")).toHaveText("0");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/chinese-checkers/1.0.2/play/index.html",
      );
      await expect(
        chineseCheckersSurface(page).locator('[data-occupied="true"]'),
      ).toHaveCount(18);
    }),
  );
  const roundTwoActiveRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  expect(roundTwoActiveRoom?.previousFinalizedSetup).toEqual({
    config: null,
    participantSlotIds: setupAssignmentsByStableSlot.map(
      (assignment) => assignment.slotId,
    ),
    playerOrder: [slotA, slotB, slotC],
    assignments: [
      { slotId: slotA, assignment: "N" },
      { slotId: slotB, assignment: "S" },
      { slotId: slotC, assignment: "NE" },
    ],
  });

  await Promise.all([pageB, pageC].map((page) => openGameHud(page)));
  expect(await acceptResignation(pageB)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 1);
  expect(await acceptResignation(pageC)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 2);
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  const roundTwoRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  const roundTwo = roundTwoRoom?.currentRound;
  if (roundTwo === null || roundTwo === undefined) {
    throw new Error("The second Chinese Checkers round was not archived.");
  }
  expect(roundTwo).toMatchObject({
    roundNumber: 2,
    revision: 2,
    status: "completed",
  });
  expect(roundTwo.replayId).not.toBe(roundOneReplayId);

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "chinese-checkers-e2e-replays",
    maxConnections: 2,
  });
  try {
    const replayStore = new PostgresReplayStore(rebuiltClient.database);
    const [roundOneReplay, roundTwoReplay] = await Promise.all([
      replayStore.get(roundOneReplayId),
      replayStore.get(roundTwo.replayId),
    ]);
    const expectedPlayers = [
      { slotId: slotA, assignment: "N" },
      { slotId: slotB, assignment: "S" },
      { slotId: slotC, assignment: "NE" },
    ];
    expect(roundOneReplay?.header.players).toEqual(expectedPlayers);
    expect(roundTwoReplay?.header.players).toEqual(expectedPlayers);
    expect(roundOneReplay?.actions).toHaveLength(3);
    expect(roundTwoReplay?.actions).toHaveLength(2);
    expect(roundOneReplay?.header.rng.seed).not.toBe(
      roundTwoReplay?.header.rng.seed,
    );
    expect(verifyReplay(roundOneReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "RANKING" },
    });
    expect(verifyReplay(roundTwoReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "RANKING" },
    });
  } finally {
    await rebuiltClient.close();
  }

  const [historyA, historyB, historyC] = await Promise.all([
    readHistory(pageA),
    readHistory(pageB),
    readHistory(pageC),
  ]);
  for (const history of [historyA, historyB, historyC]) {
    expect(history).toHaveLength(2);
    expect(history.map((match) => match.roundNumber).sort()).toEqual([1, 2]);
    expect(
      history.every(
        (match) =>
          match.gameId === "chinese-checkers" &&
          match.gameVersion === "1.0.0" &&
          match.replayAvailable === true,
      ),
    ).toBe(true);
  }
  expect(new Set(historyA.map((match) => match.matchId))).toEqual(
    new Set(historyB.map((match) => match.matchId)),
  );
  expect(new Set(historyA.map((match) => match.matchId))).toEqual(
    new Set(historyC.map((match) => match.matchId)),
  );

  await openGameHud(pageA);
  await pageA.getByTestId("close-room").click();
  await Promise.all(
    pages.map((page) =>
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
    "/game-surfaces/chinese-checkers/1.0.2/replay/index.html",
  );
  const replaySurface = chineseCheckersSurface(pageA);
  await expect(replaySurface.locator("[data-cell-index]")).toHaveCount(73);
  await expect(pageA.getByTestId("replay-frame-count")).toHaveText("1 / 4");
  await expect(replaySurface.locator('[data-occupied="true"]')).toHaveCount(18);
  await expect(
    replaySurface.locator("[data-cell-index]:not(:disabled)"),
  ).toHaveCount(0);
  await pageA.getByTestId("replay-last").click();
  await expect(pageA.getByTestId("replay-frame-count")).toHaveText("4 / 4");
  await expect(
    replaySurface.getByRole("list", { name: "最终排名" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(replaySurface.getByTestId("turn-status")).toContainText(
    "第一名：北营地",
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close(), contextC.close()]);
});
