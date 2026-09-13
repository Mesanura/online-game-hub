import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { registerE2eAccount } from "../src/account.js";
import { openGameHud } from "../src/game-hud.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

interface HistoryMetadata {
  readonly matchId: string;
  readonly gameId: string;
  readonly status: "completed" | "abandoned" | "active" | "waiting";
  readonly replayAvailable: boolean;
}

let harness: E2eHarness;
let account: BrowserContext;
let archivedMatches: readonly HistoryMetadata[];

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function archiveRound(
  owner: Page,
  guest: Page,
  gameId: "tic-tac-toe" | "pong",
  completed: boolean,
) {
  await guest.goto(harness.webUrl + "/games");
  await owner.goto(harness.webUrl + "/games/" + gameId);
  await owner.getByTestId("create-room").click();
  await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
  await owner
    .frameLocator('[data-testid="game-surface-iframe"]')
    .getByRole("button", {
      name: gameId === "pong" ? "房主在左" : "房主先手",
    })
    .click();
  const invitation = await owner
    .getByTestId("invite-link")
    .getAttribute("href");
  if (invitation === null) throw new Error("Room invitation is missing.");
  await guest.goto(invitation);
  await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
  await owner.getByTestId("toggle-round-ready").click();
  await guest.getByTestId("toggle-round-ready").click();
  await expect(owner.getByTestId("match-status")).toHaveText("对局进行中");
  await expect(guest.getByTestId("match-status")).toHaveText("对局进行中");
  const actor = completed ? guest : owner;
  await openGameHud(actor);
  actor.once("dialog", (dialog) => void dialog.accept());
  await actor.getByTestId(completed ? "resign-game" : "close-room").click();
  if (!completed) {
    await expect(owner.getByTestId("create-room")).toBeVisible();
  } else if (gameId === "pong") {
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return owner.getByTestId("match-status").textContent();
      })
      .toBe("对局已完成");
  } else {
    await expect(owner.getByTestId("match-status")).toHaveText("对局已完成");
  }
}

test.beforeAll(async ({ browser }) => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
  account = await browser.newContext();
  const guests = await browser.newContext();
  const owner = await account.newPage();
  const guest = await guests.newPage();
  try {
    await registerE2eAccount(
      account.request,
      harness.webUrl,
      "history_filter_owner",
    );
    await archiveRound(owner, guest, "tic-tac-toe", true);
    await archiveRound(owner, guest, "pong", true);
    await archiveRound(owner, guest, "tic-tac-toe", false);
    const response = await account.request.get(harness.webUrl + "/api/matches");
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { matches: HistoryMetadata[] };
    archivedMatches = payload.matches;
    expect(archivedMatches).toHaveLength(3);
    expect(
      archivedMatches.filter((match) => match.status === "completed"),
    ).toHaveLength(2);
    expect(
      archivedMatches.filter((match) => match.status === "abandoned"),
    ).toHaveLength(1);
  } finally {
    await owner.close();
    await guests.close();
  }
});

test.afterAll(async () => {
  await account?.close();
  await harness?.stop();
});

test("history combines local filters, preserves server order and restores filters after replay and refresh", async () => {
  const page = await account.newPage();
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/matches") requests += 1;
  });
  try {
    await page.goto(
      harness.webUrl + "/account/matches?game=unknown&status=invalid",
    );
    const rows = page.locator(".history-row");
    const game = page.getByRole("combobox", { name: "游戏", exact: true });
    const status = page.getByRole("combobox", { name: "对局状态" });
    await expect(rows).toHaveCount(3);
    await expect(
      page.getByText("仅显示最近 50 条对局，筛选在这些记录中进行。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-match-id")),
      ),
    ).toEqual(archivedMatches.map((match) => match.matchId));
    await expect(game).toHaveValue("");
    await expect(status).toHaveValue("");
    const historyLength = await page.evaluate(() => window.history.length);

    await game.selectOption("pong");
    await status.selectOption("completed");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("乒乓对战");
    await expect(page.getByRole("link", { name: "进入回放" })).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "条对局" }),
    ).toHaveText("显示 1 / 3 条对局");
    await status.selectOption("active");
    await expect(
      page.getByRole("heading", { name: "没有匹配的对局" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "查看最近对局" }).click();
    await expect(rows).toHaveCount(3);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => window.history.length)).toBe(
      historyLength,
    );

    await game.selectOption("tic-tac-toe");
    await status.selectOption("completed");
    await expect(rows).toHaveCount(1);
    const filteredUrl = page.url();
    const replayLink = page.getByRole("link", { name: "进入回放" });
    await replayLink.click();
    await expect(page.getByTestId("replay-page")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(filteredUrl);
    await expect(game).toHaveValue("tic-tac-toe");
    await expect(status).toHaveValue("completed");
    await expect(rows).toHaveCount(1);
    await page.reload();
    await expect(game).toHaveValue("tic-tac-toe");
    await expect(status).toHaveValue("completed");
    await expect(rows).toHaveCount(1);
  } finally {
    await page.close();
  }
});

test("history retries a failed request once and retains the latest filters during a delayed response", async () => {
  const page = await account.newPage();
  const gate = deferred();
  let requests = 0;
  await page.route("**/api/matches", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 503,
        json: { code: "MATCH_HISTORY_UNAVAILABLE" },
      });
    } else {
      await gate.promise;
      await route.continue();
    }
  });
  try {
    await page.goto(
      harness.webUrl + "/account/matches?game=pong&status=completed",
    );
    await expect(
      page.getByRole("alert").filter({ hasText: "历史加载失败" }),
    ).toBeVisible();
    const game = page.getByRole("combobox", { name: "游戏", exact: true });
    const status = page.getByRole("combobox", { name: "对局状态" });
    await expect(game).toHaveValue("pong");
    await expect(status).toHaveValue("completed");
    await page.getByRole("button", { name: "重试", exact: true }).dblclick();
    await expect(
      page.getByRole("button", { name: "重试中…", exact: true }),
    ).toBeDisabled();
    await expect.poll(() => requests).toBe(2);
    await expect(game).toHaveValue("pong");
    await game.selectOption("tic-tac-toe");
    await expect(game).toHaveValue("tic-tac-toe");
    expect(requests).toBe(2);
    gate.resolve();
    await expect(page.locator(".history-row")).toHaveCount(1);
    await expect(page.locator(".history-row")).toContainText("井字棋");
    await expect(status).toHaveValue("completed");
    await expect(
      page.getByRole("button", { name: "重试", exact: true }),
    ).toHaveCount(0);
    expect(requests).toBe(2);
  } finally {
    gate.resolve();
    await page.close();
  }
});

test("leaving history aborts an in-flight request and a late unauthorized response cannot replace the returned page", async () => {
  const page = await account.newPage();
  const captured = deferred();
  const release = deferred();
  const delivered = deferred();
  let requests = 0;
  await page.route("**/api/matches", async (route) => {
    requests += 1;
    if (requests === 1) {
      captured.resolve();
      await release.promise;
      try {
        await route.fulfill({
          status: 401,
          json: { code: "ACCOUNT_SESSION_REQUIRED" },
        });
      } finally {
        delivered.resolve();
      }
    } else {
      await route.continue();
    }
  });
  try {
    const historyUrl =
      harness.webUrl + "/account/matches?game=pong&status=completed";
    await page.goto(historyUrl);
    await captured.promise;
    const cancelled = page.waitForEvent("requestfailed", {
      predicate: (request) =>
        new URL(request.url()).pathname === "/api/matches",
    });
    await page.getByRole("link", { name: "账户设置", exact: true }).click();
    await expect(page).toHaveURL(harness.webUrl + "/account");
    await cancelled;
    await page.goBack();
    await expect(page.locator(".history-row")).toHaveCount(1);
    await expect.poll(() => requests).toBe(2);
    release.resolve();
    await delivered.promise;
    await expect(page).toHaveURL(historyUrl);
    await expect(page.locator(".history-row")).toContainText("乒乓对战");
    await expect(
      page.getByRole("combobox", { name: "游戏", exact: true }),
    ).toHaveValue("pong");
    await expect(
      page.getByRole("heading", { name: "历史加载失败" }),
    ).toHaveCount(0);
  } finally {
    release.resolve();
    await page.close();
  }
});

test("history controls fit desktop, tablet and mobile with visible keyboard focus", async () => {
  const info = test.info();
  const page = await account.newPage();
  try {
    await page.goto(harness.webUrl + "/account/matches?status=completed");
    await expect(page.locator(".history-row")).toHaveCount(2);
    const game = page.getByRole("combobox", { name: "游戏", exact: true });
    const status = page.getByRole("combobox", { name: "对局状态" });
    const clear = page.getByRole("button", { name: "清空筛选", exact: true });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      for (const control of [game, status, clear]) {
        const bounds = await control.boundingBox();
        if (bounds === null)
          throw new Error("History filter has no layout box.");
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await game.focus();
      await page.keyboard.press("Tab");
      await expect(status).toBeFocused();
      expect(
        await status.evaluate(
          (element) => getComputedStyle(element).outlineWidth,
        ),
      ).toBe("3px");
      await page.keyboard.press("Tab");
      await expect(clear).toBeFocused();
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({
          path: info.outputPath(`history-filters-${viewport.width}.png`),
          fullPage: true,
        });
      }
    }
  } finally {
    await page.close();
  }
});

test("an unrelated account has an empty history and session expiry still redirects to login", async ({
  browser,
}) => {
  const other = await browser.newContext();
  try {
    await registerE2eAccount(
      other.request,
      harness.webUrl,
      "history_filter_empty",
    );
    const page = await other.newPage();
    await page.goto(
      harness.webUrl + "/account/matches?game=pong&status=completed",
    );
    await expect(
      page.getByRole("heading", { name: "还没有登录态对局" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "没有匹配的对局" }),
    ).toHaveCount(0);
    await expect(page.locator(".history-row")).toHaveCount(0);
    const privateMatch = archivedMatches.find((match) => match.replayAvailable);
    if (privateMatch === undefined)
      throw new Error("Completed private replay is missing.");
    const history = await other.request.get(
      `${harness.webUrl}/api/matches?matchId=${privateMatch.matchId}`,
    );
    expect(history.status()).toBe(200);
    expect(await history.json()).toEqual({ matches: [] });
    expect(
      (
        await other.request.get(
          `${harness.webUrl}/api/matches/${privateMatch.matchId}/replay`,
        )
      ).status(),
    ).toBe(404);
    const logout = await other.request.post(
      harness.webUrl + "/api/auth/logout",
      {
        headers: { origin: harness.webUrl, "content-type": "application/json" },
        data: {},
      },
    );
    expect(logout.ok()).toBe(true);
    await page.reload();
    await expect(page).toHaveURL(
      harness.webUrl + "/login?next=%2Faccount%2Fmatches",
    );
  } finally {
    await other.close();
  }
});
