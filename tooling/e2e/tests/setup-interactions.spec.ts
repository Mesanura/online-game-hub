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

test("Chinese Checkers previews camps, restores rejected counts and explains an unoccupied starter", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext()),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const owner = pages[0],
    second = pages[1],
    third = pages[2];
  if (owner === undefined || second === undefined || third === undefined)
    throw new Error("Three pages are required.");
  try {
    await owner.goto(`${harness.webUrl}/games/chinese-checkers`);
    await owner.getByTestId("create-room").click();
    const count = surface(owner).getByLabel("参赛人数");
    await count.selectOption("3");
    await expect(count).toHaveValue("3");
    await expect(surface(owner).getByLabel("开局前提示")).toContainText(
      "你还没有选择营地",
    );
    await surface(owner).locator('[data-camp-option="N"]').click();
    await surface(owner).getByRole("button", { name: "指定首位" }).click();
    const invite = await owner.getByTestId("invite-link").getAttribute("href");
    if (invite === null) throw new Error("Missing invitation.");
    for (const page of [second, third]) await page.goto(invite);
    await surface(second).locator('[data-camp-option="S"]').click();
    await surface(third).locator('[data-camp-option="NE"]').click();
    await expect(
      surface(owner).locator('[data-preview-camp="N"]'),
    ).toHaveAttribute("data-self", "true");
    await expect(
      surface(owner).locator('[data-preview-camp="S"]'),
    ).toHaveAttribute("data-target", "true");
    await expect(
      surface(owner).locator('[data-preview-camp="NE"]'),
    ).toHaveAttribute("data-occupied", "true");
    await expect(
      surface(second).locator('[data-camp-option="N"]'),
    ).toBeDisabled();
    await count.focus();
    await count.selectOption("2");
    await expect(
      surface(owner).getByRole("status").filter({ hasText: "不能少于" }),
    ).toBeVisible();
    await expect(count).toHaveValue("3");
    await expect(count).toBeFocused();
    const first = surface(owner).getByRole("combobox", {
      name: "首位营地",
      exact: true,
    });
    await first.selectOption("NW");
    await expect(surface(owner).getByLabel("开局前提示")).toContainText(
      "首位营地无人参与",
    );
    await expect(owner.getByTestId("toggle-round-ready")).toBeDisabled();
    await first.selectOption("NE");
    await expect(owner.getByTestId("toggle-round-ready")).toBeEnabled();
    await surface(third).locator('[data-camp-option="NW"]').click();
    await expect(surface(owner).getByLabel("开局前提示")).toContainText(
      "首位营地无人参与",
    );
    await first.selectOption("NW");
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await owner.setViewportSize(viewport);
      await expectSetupFits(owner);
    }
    await owner.reload();
    await expect(
      surface(owner).getByRole("combobox", { name: "首位营地", exact: true }),
    ).toHaveValue("NW");
    await expect(
      surface(owner).locator('[data-camp-option="N"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await owner.getByTestId("close-room").click();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("Tank Maze shows three players' colors and blocks overcapacity without discarding selections", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext()),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const owner = pages[0],
    second = pages[1];
  if (owner === undefined || second === undefined)
    throw new Error("Two pages are required.");
  try {
    await owner.goto(`${harness.webUrl}/games/tank-maze`);
    await owner.getByTestId("create-room").click();
    const count = surface(owner).getByLabel("本场人数");
    await count.selectOption("3");
    await surface(owner).getByLabel("获胜分数").selectOption("15");
    await surface(owner).locator('[data-color="7"]').click();
    await expect(surface(owner).getByTestId("setup-summary")).toContainText(
      "粉",
    );
    const invite = await owner.getByTestId("invite-link").getAttribute("href");
    if (invite === null) throw new Error("Missing invitation.");
    for (const page of pages.slice(1)) await page.goto(invite);
    await expect(
      surface(owner).locator("[data-participant-color]"),
    ).toHaveCount(3);
    await expect(surface(second).locator('[data-color="7"]')).toBeDisabled();
    await expect(surface(second).getByLabel("本场人数")).toBeDisabled();
    await count.focus();
    await count.selectOption("2");
    await expect(surface(owner).getByTestId("setup-status")).toContainText(
      "人数超出设置",
    );
    await expect(owner.getByTestId("toggle-round-ready")).toBeDisabled();
    await expect(
      surface(owner).locator("[data-participant-color]"),
    ).toHaveCount(3);
    await expect(count).toBeFocused();
    await count.selectOption("3");
    const blue = surface(owner).locator('[data-color="2"]');
    await expect(blue).toBeEnabled();
    await blue.focus();
    await blue.press("Enter");
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await expect(blue).toBeFocused();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await owner.setViewportSize(viewport);
      await expectSetupFits(owner);
    }
    await owner.reload();
    await expect(surface(owner).getByTestId("setup-summary")).toContainText(
      "3 人 · 先到 15 分获胜 · 你的颜色：蓝",
    );
    await expect(surface(owner).getByTestId("setup-preview")).toContainText(
      "4 秒得 1 分",
    );
    await owner.getByTestId("close-room").click();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
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
  for (const button of await card.locator("button, select").all()) {
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
