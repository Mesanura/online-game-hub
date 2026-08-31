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

async function playAcceptedMove(
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
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "房主尚未选择先手方",
  );
  const playerCountNotice = pageA.getByTestId("player-count-notice");
  await expect(playerCountNotice).toHaveText("等待其他玩家加入…");
  await expect(playerCountNotice).toHaveAttribute("data-state", "waiting");
  await expect(playerCountNotice).toHaveCSS("position", "fixed");
  await pageA.getByTestId("starter-owner").click();
  await expect(pageA.getByTestId("round-setup-status")).toHaveText(
    "0/2 人已准备",
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
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/2 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map(async (page) => {
      await expect(page.getByTestId("game-stage")).toBeVisible();
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
    throw new Error("Guest A history did not contain the completed match.");
  }
  expect(matchA).toEqual({
    matchId: matchA.matchId,
    roundNumber: expectedRoundNumber,
    gameId: "tic-tac-toe",
    gameVersion: "1.0.0",
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

test("two isolated guests complete win/draw, converge on reconnect, and cannot steal state", async ({
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
  capturePageErrors(pageA, browserErrors);
  capturePageErrors(pageB, browserErrors);

  await pageB.goto(`${harness.webUrl}/games/tic-tac-toe`);
  await pageB.locator("#room-code").fill(" fake2345 ");
  await pageB.getByTestId("join-room").click();
  await expect(pageB.getByTestId("connection-error")).toHaveText(
    "The game room could not be opened.",
  );

  const winningRoom = await createAndJoinRoom(pageA, pageB);
  await assertIsolatedGuestCookies(contextA, contextB);
  await expect(pageA.getByTestId("player-mark")).toContainText("X");
  await expect(pageB.getByTestId("player-mark")).toContainText("O");

  const illegalButton = pageB.locator('[data-cell-index="0"]');
  await illegalButton.evaluate((element) => {
    const propsKey = Object.keys(element).find((key) =>
      key.startsWith("__reactProps$"),
    );
    if (propsKey === undefined) {
      throw new Error("React button props were not available.");
    }
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    if (
      props === null ||
      typeof props !== "object" ||
      !("onClick" in props) ||
      typeof props.onClick !== "function"
    ) {
      throw new Error("The game button has no intent handler.");
    }
    props.onClick();
  });
  await expect(pageB.getByTestId("command-rejection")).toContainText(
    "还没有轮到你",
  );
  await expectRevision([pageA, pageB], 0);
  await expect(illegalButton).toHaveText("");

  const duplicateButton = pageA.locator('[data-cell-index="0"]');
  await duplicateButton.evaluate((element) => {
    const propsKey = Object.keys(element).find((key) =>
      key.startsWith("__reactProps$"),
    );
    if (propsKey === undefined) {
      throw new Error("React button props were not available.");
    }
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    if (
      props === null ||
      typeof props !== "object" ||
      !("onClick" in props) ||
      typeof props.onClick !== "function"
    ) {
      throw new Error("The game button has no intent handler.");
    }
    props.onClick();
    props.onClick();
  });
  await expectRevision([pageA, pageB], 1);
  await expect(pageA.getByTestId("command-rejection")).toContainText("旧画面");
  await expect(pageA.locator('[data-cell-index="0"]')).toHaveText("X");
  expect(
    await pageA
      .locator("[data-cell-index]")
      .evaluateAll((elements) =>
        elements
          .map((element) => element.textContent ?? "")
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
  await expect(pageA.locator('[data-cell-index="0"]')).toHaveText("X");
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
  await expect(pageA.getByTestId("turn-status")).toContainText("胜者：你");
  await expect(pageB.getByTestId("turn-status")).toContainText("胜者：对手");
  await assertCanonicalReplay(winningRoom.roomCode, 1, 5, "WIN");
  const persistedMatchId = await assertPrivateCompletedHistory(
    pageA,
    pageB,
    1,
    5,
  );

  const unrelatedContext = await browser.newContext();
  const missingSession = await unrelatedContext.request.get(
    `${harness.webUrl}/api/matches`,
  );
  expect(missingSession.status()).toBe(401);
  await expect(missingSession.json()).resolves.toEqual({
    code: "GUEST_SESSION_REQUIRED",
  });
  const unrelatedPage = await unrelatedContext.newPage();
  await unrelatedPage.goto(harness.webUrl);
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

  await pageA.getByTestId("starter-non-owner").click();
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
  await expect(pageA.getByTestId("player-mark")).toContainText("O");
  await expect(pageB.getByTestId("player-mark")).toContainText("X");

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
  await expect(pageA.getByTestId("turn-status")).toHaveText("平局");
  await expect(pageB.getByTestId("turn-status")).toHaveText("平局");
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

  await pageA.getByTestId("game-menu").click();
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
    "房主尚未选择先手方",
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
  pageB.once("dialog", async (dialog) => {
    leaveConfirmation = dialog.message();
    await dialog.accept();
  });
  await pageB.getByTestId("game-menu").click();
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
