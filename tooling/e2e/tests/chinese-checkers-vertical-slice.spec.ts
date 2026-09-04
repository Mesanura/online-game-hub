import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { openGameHud } from "../src/game-hud.js";
import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

async function acceptResignation(page: Page) {
  await openGameHud(page);
  const dialog = new Promise<string>((resolve) => {
    page.once("dialog", async (event) => {
      const message = event.message();
      await event.accept();
      resolve(message);
    });
  });
  await page.getByTestId("resign-game").click();
  return dialog;
}

test("three players choose camps, start, resign into a ranking, and persist replay metadata", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  await pageA.goto(`${harness.webUrl}/games/chinese-checkers`);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await pageA.getByTestId("player-count").selectOption("3");
  await pageA.locator('[data-assignment="N"]').click();
  await pageA.getByTestId("starter-owner").click();
  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null)
    throw new Error("Missing Chinese Checkers invite URL.");

  await pageB.goto(inviteUrl);
  await pageC.goto(inviteUrl);
  await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageC.getByTestId("connection-state")).toHaveText("已连接");
  await pageB.locator('[data-assignment="S"]').click();
  await pageC.locator('[data-assignment="NE"]').click();
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await pageC.getByTestId("toggle-round-ready").click();
  for (const page of [pageA, pageB, pageC]) {
    await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
    await expect(
      page.getByRole("grid", { name: "中国跳棋六芒星棋盘" }),
    ).toBeVisible();
    await expect(page.locator("[data-cell-index]")).toHaveCount(73);
  }
  const ownerSlotId = await pageA.getByTestId("player-slot").innerText();

  const secondDialog = acceptResignation(pageB);
  await expect(await secondDialog).toContain("排在未投降玩家之后");
  await expect(pageA.getByTestId("revision")).toHaveText("1");
  const thirdDialog = acceptResignation(pageC);
  await expect(await thirdDialog).toContain("排在未投降玩家之后");
  await Promise.all(
    [pageA, pageB, pageC].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  const winnerRanking = pageA
    .getByRole("list", { name: "最终排名" })
    .getByRole("listitem")
    .first();
  await expect(winnerRanking).toContainText("第 1 名");
  await expect(winnerRanking).toContainText(ownerSlotId);
  await openGameHud(pageA);
  await pageA.getByTestId("next-round-settings").click();
  await expect(pageA).toHaveURL(
    /\/games\/chinese-checkers\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  await expect(pageA.locator('[data-assignment="N"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const roomCode = new URL(inviteUrl).pathname.split("/").at(-1);
  if (roomCode === undefined) throw new Error("Invite URL omitted room code.");
  const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
  if (room === null || room.currentRound === null)
    throw new Error("Completed Chinese Checkers room was not archived.");
  const database = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "chinese-checkers-e2e-replay",
    maxConnections: 2,
  });
  try {
    const replayStore = new PostgresReplayStore(database.database);
    const replay = await replayStore.get(room.currentRound.replayId);
    expect(replay?.header.players).toEqual([
      { slotId: "slot-1", assignment: "N" },
      { slotId: "slot-2", assignment: "S" },
      { slotId: "slot-3", assignment: "NE" },
    ]);
    expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      outcome: { type: "RANKING" },
    });
  } finally {
    await database.close();
  }
  await Promise.all([contextA.close(), contextB.close(), contextC.close()]);
});
