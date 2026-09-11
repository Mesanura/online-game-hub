import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { startE2eHarness, type E2eHarness } from "../src/harness.js";
import { closeGameHud, openGameHud } from "../src/game-hud.js";

let harness: E2eHarness;
test.beforeAll(async () => {
  harness = await startE2eHarness();
});
test.afterAll(async () => {
  await harness?.stop();
});

function surface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

async function expectSetupFits(page: Page): Promise<void> {
  const frame = surface(page);
  const card = frame.locator(".setup-card");
  await expect(card).toBeVisible();
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  for (const button of await card.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
}

for (const [gameId, rule] of [
  ["tic-tac-toe", "X 先手，O 后手"],
  ["connect-four", "红棋先手，黄棋后手"],
  ["gomoku", "黑棋先手"],
  ["hex", "蓝方先手"],
  ["reversi", "黑棋先手"],
] as const) {
  test(`${gameId} Setup explains confirmed rules and retains keyboard focus on mobile`, async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();
    const errors: string[] = [];
    for (const page of [owner, guest])
      page.on("pageerror", (error) => errors.push(error.message));
    try {
      await owner.goto(`${harness.webUrl}/games/${gameId}`);
      await owner.getByTestId("create-room").click();
      await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
      await expect(surface(owner).getByTestId("setup-preview")).toContainText(
        rule,
      );
      const ownerStarter = surface(owner).getByRole("button", {
        name: "房主先手",
      });
      await ownerStarter.focus();
      await ownerStarter.press("Enter");
      await expect(ownerStarter).toHaveAttribute("aria-pressed", "true");
      await expect(ownerStarter).toBeFocused();
      const invite = await owner
        .getByTestId("invite-link")
        .getAttribute("href");
      if (invite === null) throw new Error("Room invitation is missing.");
      await guest.goto(invite);
      await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
      await expect(surface(guest).getByTestId("setup-summary")).toContainText(
        "房主",
      );
      await expect(ownerStarter).toBeFocused();
      await expect(
        surface(guest).getByRole("button", { name: "房主先手" }),
      ).toBeDisabled();
      await expect(surface(guest).locator(".setup-card")).toContainText(
        "由房主修改",
      );

      if (gameId === "gomoku") {
        await owner.getByTestId("toggle-round-ready").click();
        await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
          "取消准备",
        );
        const largeBoard = surface(owner).getByRole("button", {
          name: "19×19",
        });
        await largeBoard.focus();
        await largeBoard.press("Enter");
        await expect(largeBoard).toHaveAttribute("aria-pressed", "true");
        await expect(largeBoard).toBeFocused();
        await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
          "准备开始",
        );
        for (const page of [owner, guest]) {
          await expect(
            surface(page).getByTestId("setup-preview"),
          ).toHaveAttribute("data-board-size", "19");
          await expect(
            surface(page).locator("[data-preview-line]"),
          ).toHaveCount(19);
        }
      }
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await owner.setViewportSize(viewport);
        await expectSetupFits(owner);
      }
      await owner.reload();
      await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
      await expect(
        surface(owner).getByRole("button", { name: "房主先手" }),
      ).toHaveAttribute("aria-pressed", "true");
      if (gameId === "gomoku") {
        await expect(
          surface(owner).getByTestId("setup-preview"),
        ).toHaveAttribute("data-board-size", "19");
        await owner.getByTestId("toggle-round-ready").click();
        await guest.getByTestId("toggle-round-ready").click();
        for (const page of [owner, guest]) {
          await expect(page).toHaveURL(/\/play$/u);
          await expect(surface(page).getByRole("gridcell")).toHaveCount(361);
        }
        await openGameHud(owner);
        owner.once("dialog", (dialog) => {
          void dialog.accept();
        });
        await owner.getByTestId("resign-game").click();
        await expect(owner.getByTestId("match-status")).toHaveText(
          "对局已完成",
        );
        await closeGameHud(owner);
        await owner.getByTestId("next-round-settings").click();
        await expect(
          surface(owner).getByTestId("setup-preview"),
        ).toHaveAttribute("data-board-size", "19");
        await expect(surface(owner).getByTestId("setup-summary")).toContainText(
          "沿用上一局",
        );
        const roomCode = new URL(invite).pathname.split("/").at(-1) ?? "";
        const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
        const replay = await harness.gameServer.replayStore.get(
          room?.currentRound?.replayId ?? "",
        );
        expect(replay?.header.initialConfig).toEqual({
          boardSize: 19,
          winLength: 5,
        });
      }
      expect(errors).toEqual([]);
      await owner.getByTestId("close-room").click();
    } finally {
      await ownerContext.close();
      await guestContext.close();
    }
  });
}
