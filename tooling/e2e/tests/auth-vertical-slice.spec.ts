import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { loginE2eAccount, registerE2eAccount } from "../src/account.js";
import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

async function completeTicTacToeRound(pageA: Page, pageB: Page): Promise<void> {
  await pageA.goto(`${harness.webUrl}/games/tic-tac-toe`);
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  const invite = await pageA.getByTestId("invite-link").getAttribute("href");
  if (invite === null) throw new Error("Account E2E room has no invite URL.");
  await pageB.goto(invite);
  await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
  await pageA.getByTestId("starter-owner").click();
  await pageA.getByTestId("toggle-round-ready").click();
  await pageB.getByTestId("toggle-round-ready").click();
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局进行中"),
    ),
  );
  const moves = [
    [pageA, 0],
    [pageB, 3],
    [pageA, 1],
    [pageB, 4],
    [pageA, 2],
  ] as const;
  for (const [index, [page, cell]] of moves.entries()) {
    await page.locator(`[data-cell-index="${cell}"]`).click();
    await Promise.all(
      [pageA, pageB].map((viewer) =>
        expect(viewer.getByTestId("revision")).toHaveText(String(index + 1)),
      ),
    );
  }
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
}

test("guest rounds stay unclaimed while account rounds survive logout and another device", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  let pageA = await contextA.newPage();
  let pageB = await contextB.newPage();
  await completeTicTacToeRound(pageA, pageB);
  expect(
    (await contextA.request.get(`${harness.webUrl}/api/matches`)).status(),
  ).toBe(401);
  expect(
    (await contextB.request.get(`${harness.webUrl}/api/matches`)).status(),
  ).toBe(401);
  await Promise.all([pageA.close(), pageB.close()]);

  const usernameA = "auth_vertical_a";
  await Promise.all([
    registerE2eAccount(contextA.request, harness.webUrl, usernameA),
    registerE2eAccount(contextB.request, harness.webUrl, "auth_vertical_b"),
  ]);
  for (const context of [contextA, contextB]) {
    const history = await context.request.get(`${harness.webUrl}/api/matches`);
    expect(history.status()).toBe(200);
    await expect(history.json()).resolves.toEqual({ matches: [] });
  }

  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  await completeTicTacToeRound(pageA, pageB);
  const accountHistoryA = await contextA.request.get(
    `${harness.webUrl}/api/matches`,
  );
  const accountHistoryB = await contextB.request.get(
    `${harness.webUrl}/api/matches`,
  );
  expect(accountHistoryA.status()).toBe(200);
  expect(accountHistoryB.status()).toBe(200);
  const payloadA = (await accountHistoryA.json()) as {
    readonly matches: readonly Record<string, unknown>[];
  };
  const payloadB = (await accountHistoryB.json()) as {
    readonly matches: readonly Record<string, unknown>[];
  };
  expect(payloadA.matches).toHaveLength(1);
  expect(payloadB.matches).toHaveLength(1);
  expect(payloadA.matches[0]).toMatchObject({
    status: "completed",
    finalRevision: 5,
    playerSlotId: "slot-1",
  });
  expect(payloadB.matches[0]).toMatchObject({
    matchId: payloadA.matches[0]?.matchId,
    playerSlotId: "slot-2",
  });
  const serialized = JSON.stringify([payloadA, payloadB]);
  for (const forbidden of [
    "replayId",
    "seed",
    "state",
    "playerSessionId",
    "userId",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  await pageA.goto(`${harness.webUrl}/account/matches`);
  await expect(pageA.getByRole("heading", { name: "我的对局" })).toBeVisible();
  await expect(pageA.locator(".history-row")).toHaveCount(1);

  const secondDevice = await browser.newContext();
  await loginE2eAccount(secondDevice.request, harness.webUrl, usernameA);
  const secondDeviceHistory = await secondDevice.request.get(
    `${harness.webUrl}/api/matches`,
  );
  expect(secondDeviceHistory.status()).toBe(200);
  await expect(secondDeviceHistory.json()).resolves.toEqual(payloadA);

  const logout = await contextA.request.post(
    `${harness.webUrl}/api/auth/logout`,
    {
      headers: { origin: harness.webUrl, "content-type": "application/json" },
      data: {},
    },
  );
  expect(logout.status()).toBe(204);
  expect(
    (await contextA.request.get(`${harness.webUrl}/api/matches`)).status(),
  ).toBe(401);
  await pageA.goto(`${harness.webUrl}/account/matches`);
  await expect(pageA).toHaveURL(/\/login\?next=/u);

  await loginE2eAccount(contextA.request, harness.webUrl, usernameA);
  const restored = await contextA.request.get(`${harness.webUrl}/api/matches`);
  expect(restored.status()).toBe(200);
  await expect(restored.json()).resolves.toEqual(payloadA);
  await Promise.all([contextA.close(), contextB.close(), secondDevice.close()]);
});
