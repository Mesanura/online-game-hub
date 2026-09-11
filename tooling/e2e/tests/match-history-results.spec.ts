import { expect, test } from "@playwright/test";
import { registerE2eAccount } from "../src/account.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";
import { openGameHud } from "../src/game-hud.js";

let harness: E2eHarness;
test.beforeAll(async () => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
});
test.afterAll(async () => {
  await harness?.stop();
});

for (const gameId of ["pong", "tank-maze"] as const) {
  test(`${gameId} history shows the account result on desktop and mobile without playback`, async ({
    browser,
  }, info) => {
    const a = await browser.newContext(),
      b = await browser.newContext();
    try {
      await registerE2eAccount(
        a.request,
        harness.webUrl,
        `history_${gameId.replaceAll("-", "_")}`,
      );
      const pageA = await a.newPage(),
        pageB = await b.newPage();
      await pageA.goto(harness.webUrl + "/account/matches");
      await expect(pageA.getByText("还没有登录态对局")).toBeVisible();
      await pageA.goto(harness.webUrl + "/games/" + gameId);
      await pageA.getByTestId("create-room").click();
      await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
      if (gameId === "pong")
        await pageA
          .frameLocator('[data-testid="game-surface-iframe"]')
          .getByRole("button", { name: "房主发球" })
          .click();
      const invite = await pageA
        .getByTestId("invite-link")
        .getAttribute("href");
      if (invite === null) throw new Error("Missing invitation");
      await pageB.goto(invite);
      await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
      await pageA.getByTestId("toggle-round-ready").click();
      await pageB.getByTestId("toggle-round-ready").click();
      await expect(pageB.getByTestId("match-status")).toHaveText("对局进行中");
      await openGameHud(pageB);
      pageB.once("dialog", (dialog) => {
        void dialog.accept();
      });
      await pageB.getByTestId("resign-game").click();
      await expect
        .poll(async () => {
          harness.advanceRealtimeTicks(1);
          return pageA.getByTestId("match-status").textContent();
        })
        .toBe("对局已完成");
      const response = await a.request.get(harness.webUrl + "/api/matches");
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.matches[0]).toMatchObject({
        gameId,
        replayAvailable: false,
        result:
          gameId === "pong"
            ? { kind: "score", own: 0, opponent: 0 }
            : { kind: "rank", rank: 1, tied: true },
      });
      await pageA.goto(harness.webUrl + "/account/matches");
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ]) {
        await pageA.setViewportSize(viewport);
        const result = pageA.locator(".history-result");
        await expect(result).toContainText(
          gameId === "pong" ? "0 : 0" : "并列第 1 名",
        );
        if (gameId === "pong")
          await expect(result).toContainText("我方 : 对方");
        await expect(pageA.getByRole("link", { name: "进入回放" })).toHaveCount(
          0,
        );
        expect(
          await pageA.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await pageA.screenshot({
          path: info.outputPath(`history-${viewport.width}.png`),
        });
      }
      // Fault-injected HTTP payloads exercise the page fallback after a real archived round.
      await pageA.route("**/api/matches", (route) =>
        route.fulfill({
          json: { matches: [{ ...payload.matches[0], result: null }] },
        }),
      );
      await pageA.reload();
      await expect(pageA.locator(".history-result")).toHaveText("结果暂不可用");
      await pageA.unroute("**/api/matches");
      await pageA.route("**/api/matches", (route) =>
        route.fulfill({
          json: { matches: [{ ...payload.matches[0], status: "active" }] },
        }),
      );
      await pageA.reload();
      await expect(pageA.locator(".history-row")).toContainText("进行中");
      await expect(pageA.locator(".history-result")).toHaveCount(0);
      await pageA.unroute("**/api/matches");
      await pageA.route("**/api/matches", (route) =>
        route.fulfill({
          status: 503,
          json: { code: "MATCH_HISTORY_UNAVAILABLE" },
        }),
      );
      await pageA.reload();
      await expect(
        pageA.getByRole("alert").filter({ hasText: "历史加载失败" }),
      ).toBeVisible();
    } finally {
      await a.close();
      await b.close();
    }
  });
}
