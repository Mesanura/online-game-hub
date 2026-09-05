import { expect, test } from "@playwright/test";
import type {
  BrowserContext,
  FrameLocator,
  Locator,
  Page,
} from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { openGameHud } from "../src/game-hud.js";
import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";
import { registerE2eAccount } from "../src/account.js";

interface JoinedRoom {
  readonly inviteUrl: string;
  readonly roomCode: string;
  readonly slotA: string;
  readonly slotB: string;
}

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

function ticTacToeSurface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

function ticTacToeCell(page: Page, cell: number): Locator {
  return ticTacToeSurface(page).locator(".tic-board button").nth(cell);
}

async function selectSurfaceStarter(
  page: Page,
  name: "房主先手" | "另一位玩家先手" | "随机先手",
): Promise<void> {
  await ticTacToeSurface(page).getByRole("button", { name }).click();
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

async function playAcceptedMove(
  actor: Page,
  viewers: readonly Page[],
  cell: number,
  revision: number,
): Promise<void> {
  const button = ticTacToeCell(actor, cell);
  await expect(button).toBeEnabled();
  await button.click();
  await expectRevision(viewers, revision);
}

async function createAndJoinRoom(
  pageA: Page,
  pageB: Page,
): Promise<JoinedRoom> {
  await pageA.goto(`${harness.webUrl}/games/tic-tac-toe`);
  await expect(
    pageA.getByRole("link", { name: "游戏目录", exact: true }),
  ).toHaveClass(/header-nav-link/u);
  const roomCodeInput = pageA.getByLabel("房间码");
  await expect(roomCodeInput).toHaveValue("");
  await expect(roomCodeInput).toHaveAttribute("placeholder", "例如 K7M4Q2");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("match-status")).toHaveCount(0);
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/tic-tac-toe/1.0.3/setup/index.html",
  );
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "请先完成本局游戏设置",
  );
  const playerCountNotice = pageA.getByTestId("player-count-notice");
  await expect(playerCountNotice).toHaveText("等待其他玩家加入…");
  await expect(playerCountNotice).toHaveAttribute("data-state", "waiting");
  await expect(playerCountNotice).toHaveCSS("position", "fixed");
  await selectSurfaceStarter(pageA, "房主先手");
  await expect(
    ticTacToeSurface(pageA).getByRole("button", { name: "房主先手" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "请先完成本局游戏设置",
  );

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) {
    throw new Error("The Web app did not expose an invitation URL.");
  }
  await pageA.getByTestId("copy-invite-link").click();
  await expect(pageA.getByTestId("copy-invite-link")).toHaveText("已复制");
  await expect(pageA.getByTestId("copy-invite-status")).toHaveText(
    "邀请链接已复制。",
  );
  await expect
    .poll(() => pageA.evaluate(() => navigator.clipboard.readText()))
    .toBe(inviteUrl);
  await pageA.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: () => Promise.resolve(""),
        writeText: () => Promise.reject(new Error("clipboard unavailable")),
      },
    });
  });
  await pageA.getByTestId("copy-invite-link").click();
  await expect(pageA.getByTestId("copy-invite-link")).toHaveText(
    "复制邀请链接",
  );
  await expect(pageA.getByTestId("copy-invite-status")).toHaveText(
    "复制失败，请选择下方链接手动复制。",
  );
  await expect(pageA.getByTestId("invite-fallback")).toHaveValue(inviteUrl);
  await expect(playerCountNotice).toHaveAttribute("data-state", "waiting");
  const invitation = new URL(inviteUrl);
  expect(invitation.origin).toBe(harness.webUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/tic-tac-toe\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  expect([...invitation.searchParams.keys()]).toEqual([]);
  const roomCode = invitation.pathname.split("/").at(-1) ?? "";
  expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);

  const nonCanonicalInvitation = new URL(
    `/games/tic-tac-toe?roomCode=${encodeURIComponent(` ${roomCode.toLowerCase()} `)}`,
    harness.webUrl,
  );
  await pageB.goto(nonCanonicalInvitation.toString());
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("connection-state")).toHaveText("已连接"),
    ),
  );
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "0/2 人已准备",
  );
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/2 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("game-stage")).toBeVisible();
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/tic-tac-toe/1.0.3/play/index.html",
      );
      const readyNotice = page.getByTestId("player-count-notice");
      await expect(readyNotice).toHaveText("玩家已到齐，游戏开始！");
      await expect(readyNotice).toHaveAttribute("data-state", "ready");
      const activeStatus = page.getByTestId("match-status");
      await expect(activeStatus).toHaveText("对局进行中");
      await expect(activeStatus).toHaveAttribute("data-status", "active");
    }),
  );
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("player-count-notice")).toHaveCount(0, {
        timeout: 6_000,
      }),
    ),
  );
  await expect(pageB.getByTestId("room-code")).toHaveText(roomCode);

  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined) {
    throw new Error("A connected player is missing its stable slot.");
  }
  expect(slotA === slotB).toBe(false);
  return { inviteUrl, roomCode, slotA, slotB };
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
  expect(cookieA.sameSite).toBe("Lax");
  expect(cookieB.sameSite).toBe("Lax");
  expect(cookieA.secure).toBe(false);
  expect(cookieB.secure).toBe(false);
  expect(cookieA.value === cookieB.value).toBe(false);
}

async function assertCanonicalReplay(
  roomCode: string,
  expectedRoundNumber: number,
  expectedRevision: number,
  expectedOutcomeType: "WIN" | "DRAW",
): Promise<void> {
  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null) {
    throw new Error("The completed E2E room was not persisted.");
  }
  const currentRound = room.currentRound;
  if (currentRound === null) {
    throw new Error("The completed E2E round was not persisted.");
  }
  expect(currentRound.revision).toBe(expectedRevision);
  expect(currentRound.roundNumber).toBe(expectedRoundNumber);
  expect(currentRound.status).toBe("completed");
  const replay = await harness.gameServer.replayStore.get(
    currentRound.replayId,
  );
  if (replay === null) {
    throw new Error("The completed E2E replay was not persisted.");
  }
  expect(replay.actions.length).toBe(expectedRevision);
  const verification = verifyReplay(replay, resolveGameDefinition);
  if (verification.status !== "verified") {
    throw new Error(`Canonical E2E replay failed with ${verification.code}.`);
  }
  const outcome = verification.outcome;
  expect(
    outcome !== null &&
      typeof outcome === "object" &&
      "type" in outcome &&
      outcome.type === expectedOutcomeType,
  ).toBe(true);

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "online-game-hub-e2e-rebuilt-replay",
    maxConnections: 2,
  });
  try {
    const rebuiltReplay = await new PostgresReplayStore(
      rebuiltClient.database,
    ).get(currentRound.replayId);
    expect(rebuiltReplay?.actions).toHaveLength(expectedRevision);
    expect(verifyReplay(rebuiltReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
    });
  } finally {
    await rebuiltClient.close();
  }
}

async function assertPrivateCompletedHistory(
  pageA: Page,
  pageB: Page,
  expectedRoundNumber: number,
  expectedRevision: number,
): Promise<string> {
  const [responseA, responseB] = await Promise.all([
    pageA.request.get(`${harness.webUrl}/api/matches`),
    pageB.request.get(`${harness.webUrl}/api/matches`),
  ]);
  expect(responseA.status()).toBe(200);
  expect(responseB.status()).toBe(200);
  expect(responseA.headers()["cache-control"]).toBe("no-store, private");
  const bodyA = (await responseA.json()) as {
    readonly matches?: readonly Record<string, unknown>[];
  };
  const bodyB = (await responseB.json()) as {
    readonly matches?: readonly Record<string, unknown>[];
  };
  const matchA = bodyA.matches?.find(
    (match) =>
      match.status === "completed" && match.finalRevision === expectedRevision,
  );
  if (matchA === undefined || typeof matchA.matchId !== "string") {
    throw new Error("Account A history did not contain the completed match.");
  }
  expect(matchA).toEqual({
    matchId: matchA.matchId,
    roundNumber: expectedRoundNumber,
    gameId: "tic-tac-toe",
    gameVersion: "1.1.0",
    status: "completed",
    finalRevision: expectedRevision,
    playerSlotId: "slot-1",
    createdAt: expect.any(String),
    startedAt: expect.any(String),
    finishedAt: expect.any(String),
    replayAvailable: true,
  });
  expect(bodyB.matches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        matchId: matchA.matchId,
        roundNumber: expectedRoundNumber,
        playerSlotId: "slot-2",
        status: "completed",
        replayAvailable: true,
      }),
    ]),
  );
  const serialized = JSON.stringify([bodyA, bodyB]);
  for (const forbidden of [
    "playerSessionId",
    "userId",
    "runtimeRoomId",
    "initialConfig",
    "acceptedActions",
    "recordedOutcome",
    "rngSeed",
    "authoritativeState",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  return matchA.matchId;
}

test("two isolated accounts complete win/draw, converge on reconnect, and cannot steal state", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: harness.webUrl,
  });
  const browserErrors: string[] = [];
  let ticketRequestsA = 0;
  let joinReservationsA = 0;
  contextA.on("request", (request) => {
    if (request.url().endsWith("/api/game-ticket")) ticketRequestsA += 1;
    if (request.url().includes("/matchmake/join/")) joinReservationsA += 1;
  });

  let pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "web_account_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "web_account_b"),
  ]);
  capturePageErrors(pageA, browserErrors);
  capturePageErrors(pageB, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const catalogHeading = pageA.locator(".catalog-heading");
  await expect(
    catalogHeading.getByTestId("catalog-return-home"),
  ).toHaveAttribute("href", "/");
  await expect(
    catalogHeading.locator("div").first().locator(":scope > :first-child"),
  ).toHaveText("返回首页");

  await pageB.goto(`${harness.webUrl}/games/tic-tac-toe`);
  await pageB.locator("#room-code").fill(" fake2345 ");
  await pageB.getByTestId("join-room").click();
  await expect(
    pageB.getByText("房间码无效或房间已关闭，请重试。", { exact: true }),
  ).toBeVisible();

  const winningRoom = await createAndJoinRoom(pageA, pageB);
  await assertIsolatedGuestCookies(contextA, contextB);
  await expect(ticTacToeSurface(pageA).locator(".mark-chip")).toHaveText(
    "你的棋子 X",
  );
  await expect(ticTacToeSurface(pageB).locator(".mark-chip")).toHaveText(
    "你的棋子 O",
  );

  const illegalButton = ticTacToeCell(pageB, 0);
  await expect(illegalButton).toBeDisabled();
  await expectRevision([pageA, pageB], 0);
  await expect(illegalButton.locator("span")).toHaveText("");

  await playAcceptedMove(pageA, [pageA, pageB], 0, 1);
  await expect(ticTacToeCell(pageA, 0).locator("span")).toHaveText("X");
  expect(
    await ticTacToeSurface(pageA)
      .locator(".tic-board [data-mark]")
      .evaluateAll((elements) =>
        elements
          .map((element) => element.getAttribute("data-mark") ?? "")
          .filter((value) => value.length > 0),
      ),
  ).toEqual(["X"]);

  await pageA.close();
  await expect
    .poll(async () => {
      const stored = await harness.gameServer.roomStore.getByRoomCode(
        winningRoom.roomCode,
      );
      const reservedUntil = stored?.players.find(
        (player) => player.slotId === winningRoom.slotA,
      )?.reservedUntilMilliseconds;
      return typeof reservedUntil === "number";
    })
    .toBe(true);
  harness.clock.advanceBy(30_000);

  pageA = await contextA.newPage();
  capturePageErrors(pageA, browserErrors);
  await pageA.goto(winningRoom.inviteUrl);
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("player-slot")).toHaveText(winningRoom.slotA);
  await expect(pageB.getByTestId("player-slot")).toHaveText(winningRoom.slotB);
  await expectRevision([pageA, pageB], 1);
  await expect(ticTacToeCell(pageA, 0).locator("span")).toHaveText("X");
  expect(ticketRequestsA >= 2).toBe(true);
  expect(joinReservationsA >= 1).toBe(true);

  await playAcceptedMove(pageB, [pageA, pageB], 3, 2);
  await playAcceptedMove(pageA, [pageA, pageB], 1, 3);
  await playAcceptedMove(pageB, [pageA, pageB], 4, 4);
  await playAcceptedMove(pageA, [pageA, pageB], 2, 5);
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  await expect(ticTacToeSurface(pageA).getByRole("heading")).toHaveText(
    "你赢了",
  );
  await expect(pageA.getByTestId("game-result-hud")).toContainText("你获胜");
  await expect(ticTacToeSurface(pageB).getByRole("heading")).toHaveText(
    "对手获胜",
  );
  await assertCanonicalReplay(winningRoom.roomCode, 1, 5, "WIN");
  const persistedMatchId = await assertPrivateCompletedHistory(
    pageA,
    pageB,
    1,
    5,
  );
  const replayPage = await contextA.newPage();
  await replayPage.goto(
    `${harness.webUrl}/account/matches/${encodeURIComponent(persistedMatchId)}/replay`,
  );
  await expect(replayPage.getByTestId("replay-page")).toBeVisible();
  await expect(replayPage.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/tic-tac-toe/1.0.3/replay/index.html",
  );
  await replayPage.getByTestId("replay-last").click();
  await expect(ticTacToeSurface(replayPage).getByRole("heading")).toHaveText(
    "你赢了",
  );
  await expect(ticTacToeCell(replayPage, 8)).toBeDisabled();
  await replayPage.close();

  const unrelatedContext = await browser.newContext();
  const missingSession = await unrelatedContext.request.get(
    `${harness.webUrl}/api/matches`,
  );
  expect(missingSession.status()).toBe(401);
  await expect(missingSession.json()).resolves.toEqual({
    code: "ACCOUNT_SESSION_REQUIRED",
  });
  const unrelatedPage = await unrelatedContext.newPage();
  await registerE2eAccount(
    unrelatedPage.request,
    harness.webUrl,
    "web_unrelated",
  );
  const unrelatedHistory = await unrelatedPage.request.get(
    `${harness.webUrl}/api/matches?matchId=${persistedMatchId}&playerSessionId=forged`,
  );
  expect(unrelatedHistory.status()).toBe(200);
  await expect(unrelatedHistory.json()).resolves.toEqual({ matches: [] });
  await unrelatedContext.close();

  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("round-number")).toHaveText("第 1 局"),
    ),
  );
  await expect(pageA.getByTestId("create-room")).toHaveCount(0);
  await Promise.all(
    [pageA, pageB].map((page) =>
      page.getByTestId("next-round-settings").click(),
    ),
  );
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page).toHaveURL(/\/rooms\/[A-HJ-NP-Z2-9]{8}$/u),
    ),
  );
  await expect(pageA.getByTestId("close-room")).toBeVisible();
  await expect(pageB.getByTestId("leave-room")).toBeVisible();

  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/tic-tac-toe/1.0.3/setup/index.html",
  );
  await selectSurfaceStarter(pageA, "另一位玩家先手");
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "0/2 人已准备",
  );
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageA.getByTestId("toggle-round-ready")).toHaveText("取消准备");
  await expect(pageA.getByTestId("round-setup-status")).toContainText(
    "1/2 人已准备",
  );
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageA.getByTestId("toggle-round-ready")).toHaveText("准备开始");
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "0/2 人已准备",
  );

  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/2 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("room-code")).toHaveText(
        winningRoom.roomCode,
      );
    }),
  );
  await expectRevision([pageA, pageB], 0);
  await expect(pageA.getByTestId("player-slot")).toHaveText(winningRoom.slotA);
  await expect(pageB.getByTestId("player-slot")).toHaveText(winningRoom.slotB);
  await expect(ticTacToeSurface(pageA).locator(".mark-chip")).toHaveText(
    "你的棋子 O",
  );
  await expect(ticTacToeSurface(pageB).locator(".mark-chip")).toHaveText(
    "你的棋子 X",
  );

  const drawMoves = [
    [pageB, 0],
    [pageA, 1],
    [pageB, 2],
    [pageA, 4],
    [pageB, 3],
    [pageA, 5],
    [pageB, 7],
    [pageA, 6],
    [pageB, 8],
  ] as const;
  for (const [index, [actor, cell]] of drawMoves.entries()) {
    await playAcceptedMove(actor, [pageA, pageB], cell, index + 1);
  }
  await expect(ticTacToeSurface(pageA).getByRole("heading")).toHaveText(
    "本局平局",
  );
  await expect(ticTacToeSurface(pageB).getByRole("heading")).toHaveText(
    "本局平局",
  );
  await assertCanonicalReplay(winningRoom.roomCode, 2, 9, "DRAW");
  await assertPrivateCompletedHistory(pageA, pageB, 2, 9);

  const terminalOutsiderContext = await browser.newContext();
  const terminalOutsiderPage = await terminalOutsiderContext.newPage();
  capturePageErrors(terminalOutsiderPage, browserErrors);
  await terminalOutsiderPage.goto(winningRoom.inviteUrl);
  await expect(terminalOutsiderPage.getByTestId("connection-error")).toHaveText(
    "The game room could not be opened.",
  );
  await expect(terminalOutsiderPage.getByTestId("player-slot")).toHaveCount(0);
  await terminalOutsiderContext.close();

  await openGameHud(pageA);
  await pageA.getByTestId("close-room").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("create-room")).toBeVisible(),
    ),
  );
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect
        .poll(() => new URL(page.url()).searchParams.has("roomCode"))
        .toBe(false),
    ),
  );

  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "请先完成本局游戏设置",
  );
  const waitingRoomCode = await pageA.getByTestId("room-code").innerText();
  await pageA.getByTestId("close-room").click();
  await expect(pageA.getByTestId("room-notice")).toHaveText("房主已关闭房间。");
  await expect
    .poll(async () => {
      const stored =
        await harness.gameServer.roomStore.getByRoomCode(waitingRoomCode);
      return stored?.closeReason;
    })
    .toBe("OWNER_CLOSED");

  const explicitlyLeftRoom = await createAndJoinRoom(pageA, pageB);
  let leaveConfirmation = "";
  await openGameHud(pageB);
  pageB.once("dialog", async (dialog) => {
    leaveConfirmation = dialog.message();
    await dialog.accept();
  });
  await pageB.getByTestId("leave-room").click();
  expect(leaveConfirmation).toContain("离开会立即终止当前对局");
  await expect(pageB.getByTestId("room-notice")).toHaveText("已离开房间。");
  await expect(pageA.getByTestId("room-notice")).toHaveText(
    "有玩家主动离开，本局已终止。",
  );
  await expect
    .poll(async () => {
      const stored = await harness.gameServer.roomStore.getByRoomCode(
        explicitlyLeftRoom.roomCode,
      );
      return stored?.currentRound?.status;
    })
    .toBe("abandoned");

  const abandonedRoom = await createAndJoinRoom(pageA, pageB);
  await pageA.close();
  await expect
    .poll(async () => {
      const stored = await harness.gameServer.roomStore.getByRoomCode(
        abandonedRoom.roomCode,
      );
      return stored?.players.some(
        (player) => player.reservedUntilMilliseconds !== null,
      );
    })
    .toBe(true);
  harness.clock.advanceBy(60_001);
  await expect(pageB.getByTestId("room-notice")).toContainText("重连期限");
  await expect(pageB.getByTestId("create-room")).toBeVisible();
  await expect
    .poll(async () => {
      const stored = await harness.gameServer.roomStore.getByRoomCode(
        abandonedRoom.roomCode,
      );
      return stored === null
        ? null
        : {
            status: stored.currentRound?.status,
            revision: stored.currentRound?.revision,
          };
    })
    .toEqual({ status: "abandoned", revision: 0 });

  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});

test("the shared HUD cancels and confirms a Tic-Tac-Toe resignation once", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: harness.webUrl,
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const resignedRoom = await createAndJoinRoom(pageA, pageB);

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
  expect(room?.currentRound).toMatchObject({
    revision: 1,
    status: "completed",
    outcome: {
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: resignedRoom.slotA,
      resignedSlotId: resignedRoom.slotB,
    },
  });
  const replay = await harness.gameServer.replayStore.get(
    room?.currentRound?.replayId ?? "",
  );
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

test("the game stage remains non-scrolling and overlay-safe across the viewport matrix", async ({
  browser,
}) => {
  const contextA = await browser.newContext({ reducedMotion: "reduce" });
  const contextB = await browser.newContext();
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: harness.webUrl,
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await createAndJoinRoom(pageA, pageB);

  const viewports = [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 844, height: 390 },
  ] as const;

  for (const viewport of viewports) {
    await pageA.setViewportSize(viewport);
    await expect
      .poll(() =>
        pageA.evaluate(({ width, height }) => {
          const scrollingElement = document.scrollingElement;
          const playPage = document.querySelector<HTMLElement>(".play-page");
          const rootFontSize = Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          );
          const expectedPlayPageHeight = matchMedia("(max-width: 46rem)")
            .matches
            ? height
            : height - rootFontSize * 6.25;
          return (
            window.innerWidth === width &&
            window.innerHeight === height &&
            scrollingElement !== null &&
            playPage !== null &&
            Math.abs(
              playPage.getBoundingClientRect().height - expectedPlayPageHeight,
            ) < 1 &&
            scrollingElement.scrollWidth <= scrollingElement.clientWidth &&
            scrollingElement.scrollHeight <= scrollingElement.clientHeight
          );
        }, viewport),
      )
      .toBe(true);
    await expect(pageA.getByTestId("game-stage")).toBeVisible();
    const before = await pageA.evaluate(() => {
      const stage = document.querySelector<HTMLElement>(
        '[data-testid="game-stage"]',
      );
      const drawerToggle = document.querySelector<HTMLElement>(
        '[data-testid="toggle-game-hud"]',
      );
      const fullscreenToggle = document.querySelector<HTMLElement>(
        '[data-testid="toggle-game-fullscreen"]',
      );
      const main = document.querySelector<HTMLElement>("main");
      const scrollingElement = document.scrollingElement;
      if (
        stage === null ||
        drawerToggle === null ||
        fullscreenToggle === null ||
        main === null ||
        scrollingElement === null
      ) {
        throw new Error("The play surface shell is incomplete.");
      }
      const stageRect = stage.getBoundingClientRect();
      const drawerRect = drawerToggle.getBoundingClientRect();
      const fullscreenRect = fullscreenToggle.getBoundingClientRect();
      return {
        overflowX: scrollingElement.scrollWidth > scrollingElement.clientWidth,
        overflowY:
          scrollingElement.scrollHeight > scrollingElement.clientHeight,
        stage: {
          left: stageRect.left,
          top: stageRect.top,
          right: stageRect.right,
          bottom: stageRect.bottom,
          width: stageRect.width,
          height: stageRect.height,
        },
        drawerToggle: {
          left: drawerRect.left,
          top: drawerRect.top,
          right: drawerRect.right,
          bottom: drawerRect.bottom,
        },
        fullscreenToggle: {
          left: fullscreenRect.left,
          top: fullscreenRect.top,
          right: fullscreenRect.right,
          bottom: fullscreenRect.bottom,
        },
        document: {
          clientHeight: scrollingElement.clientHeight,
          scrollHeight: scrollingElement.scrollHeight,
          bodyClientHeight: document.body.clientHeight,
          bodyScrollHeight: document.body.scrollHeight,
          mainClientHeight: main.clientHeight,
          mainScrollHeight: main.scrollHeight,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    expect(before.overflowX).toBe(false);
    expect(
      before.overflowY,
      `unexpected vertical page overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify(before.document)}`,
    ).toBe(false);
    expect(before.stage.width).toBeGreaterThan(0);
    expect(before.stage.height).toBeGreaterThan(0);
    expect(before.stage.left).toBeGreaterThanOrEqual(0);
    expect(before.stage.top).toBeGreaterThanOrEqual(0);
    expect(before.stage.right).toBeLessThanOrEqual(before.viewport.width);
    expect(before.stage.bottom).toBeLessThanOrEqual(before.viewport.height);
    expect(before.drawerToggle.left).toBeGreaterThanOrEqual(0);
    expect(before.drawerToggle.top).toBeGreaterThanOrEqual(0);
    expect(before.drawerToggle.right).toBeLessThanOrEqual(
      before.viewport.width,
    );
    expect(before.drawerToggle.bottom).toBeLessThanOrEqual(
      before.viewport.height,
    );
    expect(before.fullscreenToggle.left).toBeGreaterThanOrEqual(0);
    expect(before.fullscreenToggle.top).toBeGreaterThanOrEqual(0);
    expect(before.fullscreenToggle.right).toBeLessThanOrEqual(
      before.viewport.width,
    );
    expect(before.fullscreenToggle.bottom).toBeLessThanOrEqual(
      before.viewport.height,
    );
    expect(before.drawerToggle.left).toBeLessThan(
      before.viewport.width - before.drawerToggle.right,
    );
    expect(
      before.viewport.height - before.fullscreenToggle.bottom,
    ).toBeLessThan(before.fullscreenToggle.top);

    await openGameHud(pageA);
    const during = await pageA
      .getByTestId("game-stage")
      .evaluate((stage) => stage.getBoundingClientRect().toJSON());
    for (const edge of [
      "left",
      "top",
      "right",
      "bottom",
      "width",
      "height",
    ] as const) {
      expect(Math.abs(during[edge] - before.stage[edge])).toBeLessThan(1);
    }
    await pageA.getByTestId("close-game-hud").click();
    await expect(pageA.getByRole("dialog")).toHaveCount(0);
    await expect(pageA.getByTestId("revision")).toHaveText("0");
  }

  await pageA.evaluate(() => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });
  });
  await pageA.getByTestId("toggle-game-fullscreen").click();
  await expect(pageA.locator(".play-stage-layout")).toHaveAttribute(
    "data-focus-mode",
    "true",
  );
  await expect(pageA.getByTestId("toggle-game-fullscreen")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await pageA.keyboard.press("Escape");
  await expect(pageA.locator(".play-stage-layout")).toHaveAttribute(
    "data-focus-mode",
    "false",
  );

  await playAcceptedMove(pageA, [pageA, pageB], 0, 1);
  await Promise.all([contextA.close(), contextB.close()]);
});
