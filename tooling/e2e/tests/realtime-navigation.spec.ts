import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  createPostgresDatabaseClient,
  PostgresRealtimeRoomStore,
} from "@online-game-hub/database";

import { closeGameHud, openGameHud } from "../src/game-hud.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.beforeAll(async () => {
  // Navigation must complete while the production scheduler keeps publishing
  // snapshots. The gameplay suites deliberately pause that scheduler.
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

for (const gameId of ["pong", "badminton"] as const) {
  test(`${gameId} enters play before the running round ends, including reconnect and next-round setup`, async ({
    browser,
  }, info) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const database = createPostgresDatabaseClient({
      url: harness.databaseUrl,
      applicationName: "realtime-navigation-e2e",
      maxConnections: 2,
    });
    const roomStore = new PostgresRealtimeRoomStore(database.database);
    const surface = (page: Page) =>
      page.frameLocator('[data-testid="game-surface-iframe"]');

    try {
      await pageA.goto(`${harness.webUrl}/games/${gameId}`);
      await pageA.getByTestId("create-room").click();
      await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
      await surface(pageA).locator('[data-starter="OWNER"]').click();
      const inviteUrl = await pageA
        .getByTestId("invite-link")
        .getAttribute("href");
      if (inviteUrl === null) throw new Error("Room invite is missing.");
      const roomCode = new URL(inviteUrl).pathname.split("/").at(-1) ?? "";
      const playUrl = `${inviteUrl}/play`;
      await pageB.goto(inviteUrl);
      await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");

      for (const context of [contextA, contextB]) {
        await context.route(
          (url) => url.pathname === new URL(playUrl).pathname,
          async (route) => {
            if (route.request().headers()["rsc"] === "1") {
              const initial = (await roomStore.getByRoomCode(roomCode))
                ?.currentRound;
              // Hold each real navigation request across multiple snapshots,
              // without freezing the simulation or mocking the route response.
              if (initial?.status === "active") {
                await expect
                  .poll(async () => {
                    const current = (await roomStore.getByRoomCode(roomCode))
                      ?.currentRound;
                    return (
                      current?.status !== "active" ||
                      current.roundNumber !== initial.roundNumber ||
                      current.tick >= initial.tick + 15
                    );
                  })
                  .toBe(true);
              }
            }
            await route.continue();
          },
        );
      }

      const expectPlaying = async (page: Page, roundNumber: number) => {
        await expect(page).toHaveURL(playUrl);
        await expect(page.getByTestId("match-status")).toHaveAttribute(
          "data-status",
          "active",
        );
        await expect(page.getByTestId("round-number")).toHaveText(
          `第 ${roundNumber} 局`,
        );
        await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
          "src",
          new RegExp(`/game-surfaces/${gameId}/[^/]+/play/index\\.html$`),
        );
        await expect(surface(page).locator("canvas")).toBeVisible();
        await expect
          .poll(async () =>
            Number(await page.getByTestId("server-tick").textContent()),
          )
          .toBeGreaterThan(0);
        await expect(page.getByTestId("toggle-round-ready")).toHaveCount(0);
      };

      await pageA.getByTestId("toggle-round-ready").click();
      await pageB.getByTestId("toggle-round-ready").click();
      await Promise.all([expectPlaying(pageA, 1), expectPlaying(pageB, 1)]);
      expect(
        (await roomStore.getByRoomCode(roomCode))?.currentRound?.status,
      ).toBe("active");
      await pageA.screenshot({ path: info.outputPath(`${gameId}-active.png`) });

      const slotA = await pageA.getByTestId("player-slot").textContent();
      const slotB = await pageB.getByTestId("player-slot").textContent();
      expect(slotA).not.toBe(slotB);
      await pageA.close();
      const resumed = await contextA.newPage();
      await resumed.goto(inviteUrl);
      await expectPlaying(resumed, 1);
      await expect(resumed.getByTestId("player-slot")).toHaveText(slotA ?? "");

      await openGameHud(pageB);
      pageB.once("dialog", (dialog) => void dialog.accept());
      await pageB.getByTestId("resign-game").click();
      for (const page of [resumed, pageB]) {
        await expect(page.getByTestId("match-status")).toHaveAttribute(
          "data-status",
          "completed",
        );
        await closeGameHud(page);
        await page.getByTestId("next-round-settings").click();
        await expect(page).toHaveURL(inviteUrl);
        await expect(page.getByTestId("round-setup-surface")).toBeVisible();
      }

      await resumed.getByTestId("toggle-round-ready").click();
      await pageB.getByTestId("toggle-round-ready").click();
      await Promise.all([expectPlaying(resumed, 2), expectPlaying(pageB, 2)]);
      await expect(resumed.getByTestId("player-slot")).toHaveText(slotA ?? "");
      await expect(pageB.getByTestId("player-slot")).toHaveText(slotB ?? "");

      await openGameHud(resumed);
      resumed.once("dialog", (dialog) => void dialog.accept());
      await resumed.getByTestId("close-room").click();
      await Promise.all(
        [resumed, pageB].map((page) =>
          expect(page).toHaveURL(`${harness.webUrl}/games/${gameId}`),
        ),
      );
    } finally {
      // A failed navigation may leave requests pending until the context closes.
      await Promise.allSettled(
        [contextA, contextB].map((context) =>
          context.unrouteAll({ behavior: "ignoreErrors" }),
        ),
      );
      await Promise.all([contextA.close(), contextB.close()]);
      await database.close();
    }
  });
}
