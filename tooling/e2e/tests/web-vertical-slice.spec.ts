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
      expect(page.getByTestId("revision")).toHaveText(`Revision ${revision}`),
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
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("match-status")).toHaveText("等待另一位玩家");

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) {
    throw new Error("The Web app did not expose an invitation URL.");
  }
  const invitation = new URL(inviteUrl);
  expect(invitation.origin).toBe(harness.webUrl);
  expect(invitation.pathname).toBe("/games/tic-tac-toe");
  expect([...invitation.searchParams.keys()]).toEqual(["roomCode"]);
  const roomCode = invitation.searchParams.get("roomCode");
  if (roomCode === null) {
    throw new Error("The invitation URL did not contain a room code.");
  }
  expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);

  const nonCanonicalInvitation = new URL(invitation);
  nonCanonicalInvitation.searchParams.set(
    "roomCode",
    ` ${roomCode.toLowerCase()} `,
  );
  await pageB.goto(nonCanonicalInvitation.toString());
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("connection-state")).toHaveText("已连接"),
    ),
  );
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局进行中"),
    ),
  );
  await expect(pageB.getByTestId("room-code")).toHaveText(roomCode);

  const slotA = await pageA.getByTestId("player-slot").innerText();
  const slotB = await pageB.getByTestId("player-slot").innerText();
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
  expectedRevision: number,
  expectedOutcomeType: "WIN" | "DRAW",
): Promise<void> {
  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null) {
    throw new Error("The completed E2E room was not persisted.");
  }
  expect(room.revision).toBe(expectedRevision);
  expect(room.status).toBe("completed");
  const replay = await harness.gameServer.replayStore.get(room.replayId);
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
    ).get(room.replayId);
    expect(rebuiltReplay?.actions).toHaveLength(expectedRevision);
    expect(
      verifyReplay(rebuiltReplay, resolveGameDefinition),
    ).toMatchObject({ status: "verified" });
  } finally {
    await rebuiltClient.close();
  }
}

async function assertPrivateCompletedHistory(
  pageA: Page,
  pageB: Page,
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
      match.status === "completed" &&
      match.finalRevision === expectedRevision,
  );
  if (matchA === undefined || typeof matchA.matchId !== "string") {
    throw new Error("Guest A history did not contain the completed match.");
  }
  expect(matchA).toEqual({
    matchId: matchA.matchId,
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
  await assertCanonicalReplay(winningRoom.roomCode, 5, "WIN");
  const persistedMatchId = await assertPrivateCompletedHistory(
    pageA,
    pageB,
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

  const drawingRoom = await createAndJoinRoom(pageA, pageB);
  const drawMoves = [
    [pageA, 0],
    [pageB, 1],
    [pageA, 2],
    [pageB, 4],
    [pageA, 3],
    [pageB, 5],
    [pageA, 7],
    [pageB, 6],
    [pageA, 8],
  ] as const;
  for (const [index, [actor, cell]] of drawMoves.entries()) {
    await playAcceptedMove(actor, [pageA, pageB], cell, index + 1);
  }
  await expect(pageA.getByTestId("turn-status")).toHaveText("平局");
  await expect(pageB.getByTestId("turn-status")).toHaveText("平局");
  await assertCanonicalReplay(drawingRoom.roomCode, 9, "DRAW");

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
  await expect(pageB.getByTestId("match-status")).toHaveText("对局已终止");
  await expectRevision([pageB], 0);

  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close()]);
});
