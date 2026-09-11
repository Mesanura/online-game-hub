import { expect, test } from "@playwright/test";

import { openGameHud } from "../src/game-hud.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.use({ actionTimeout: 15_000 });

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

for (const gameId of ["tic-tac-toe", "pong"] as const) {
  test(`${gameId} preserves rejected-join feedback and can create fresh rooms after returning to entry`, async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const outsiderContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();
    const entryUrl = `${harness.webUrl}/games/${gameId}`;

    try {
      await owner.goto(entryUrl);
      await owner.getByTestId("create-room").click();
      await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
      const roomCode = await owner.getByTestId("room-code").textContent();
      if (roomCode === null) throw new Error("Room code is missing.");
      await owner
        .frameLocator('[data-testid="game-surface-iframe"]')
        .getByRole("button", {
          name: gameId === "pong" ? /^房主在左/ : "房主先手",
        })
        .click();

      await guest.goto(entryUrl);
      await guest.getByLabel("房间码").fill(roomCode);
      await guest.getByTestId("join-room").click();
      await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
      await owner.getByTestId("toggle-round-ready").click();
      await guest.getByTestId("toggle-round-ready").click();
      for (const page of [owner, guest]) {
        await expect(page).toHaveURL(`${entryUrl}/rooms/${roomCode}/play`);
        await expect(page.getByTestId("match-status")).toHaveAttribute(
          "data-status",
          "active",
        );
      }

      const cancelExit = owner.waitForEvent("dialog").then(async (dialog) => {
        expect(dialog.message()).toBe("离开会立即终止当前对局，确定继续吗？");
        await dialog.dismiss();
      });
      await owner.goBack();
      await cancelExit;
      await expect(owner).toHaveURL(`${entryUrl}/rooms/${roomCode}/play`);
      await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
      await expect(owner.getByTestId("match-status")).toHaveAttribute(
        "data-status",
        "active",
      );

      await openGameHud(guest);
      guest.once("dialog", (dialog) => void dialog.accept());
      await guest.getByTestId("resign-game").click();
      for (const page of [owner, guest]) {
        await expect(page.getByTestId("match-status")).toHaveAttribute(
          "data-status",
          "completed",
        );
      }

      const outsider = await outsiderContext.newPage();
      await outsider.goto(`${entryUrl}/rooms/${roomCode}`);
      await expect(outsider).toHaveURL(entryUrl);
      await expect(outsider.getByTestId("create-room")).toBeEnabled();
      await expect(
        outsider.locator(".page-alerts").getByRole("alert"),
      ).toHaveText("无法进入房间。房间可能已关闭，或房间码不正确。");
      await expect(outsider.getByTestId("player-slot")).toHaveCount(0);
      await expect(outsider.getByTestId("game-surface-iframe")).toHaveCount(0);
      await expect(outsider.getByLabel("房间码")).toHaveValue("");
      await outsider.getByTestId("create-room").click();
      await expect(outsider.getByTestId("connection-state")).toHaveText(
        "已连接",
      );
      await expect(outsider.getByTestId("room-code")).not.toHaveText(roomCode);
      await expect(
        outsider.locator(".page-alerts").getByRole("alert"),
      ).toHaveCount(0);
      await outsider.getByTestId("close-room").click();
      await expect(outsider).toHaveURL(entryUrl);

      for (const page of [guest, owner]) {
        await page.goBack();
        await expect(page).toHaveURL(entryUrl);
        await expect(page.getByLabel("房间码")).toHaveValue("");
        await expect(page.getByTestId("create-room")).toBeEnabled();
        await page.getByTestId("create-room").click();
        await expect(page.getByTestId("connection-state")).toHaveText("已连接");
        await expect(page.getByTestId("room-code")).not.toHaveText(roomCode);
        await expect(page.getByTestId("round-number")).toHaveText("第 1 局");
        await expect(page.getByTestId("round-setup-surface")).toBeVisible();
        await expect(page.getByTestId("game-result-hud")).toHaveCount(0);
        await page.getByTestId("close-room").click();
        await expect(page).toHaveURL(entryUrl);
        await expect(page.getByLabel("房间码")).toHaveValue("");
      }
    } finally {
      await Promise.all([
        ownerContext.close(),
        guestContext.close(),
        outsiderContext.close(),
      ]);
    }
  });
}
