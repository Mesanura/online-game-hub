import { expect, test, type Page } from "@playwright/test";

import { registerE2eAccount } from "../src/account.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.use({ actionTimeout: 15_000 });

test.beforeAll(async () => {
  harness = await startE2eHarness();
});
test.afterAll(async () => {
  await harness?.stop();
});

async function saveDisplayName(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "打开个人资料菜单" }).click();
  const profile = page.getByRole("dialog", { name: "个人资料" });
  await profile.getByLabel("显示名", { exact: true }).fill(name);
  await profile.getByRole("button", { name: "保存显示名" }).click();
  await expect(profile.getByRole("status")).toHaveText("显示名已保存。");
  await page.keyboard.press("Escape");
}

function playerCard(page: Page, slotId: string) {
  return page.locator(`[data-testid="room-player"][data-slot-id="${slotId}"]`);
}

for (const gameId of ["tic-tac-toe", "pong"] as const) {
  test(`${gameId} waiting room shares account and guest names, avatars, edits and reconnects`, async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const guestContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();
    const entryUrl = `${harness.webUrl}/games/${gameId}`;
    try {
      // Keep a different local guest profile to prove the account name comes from the server.
      await owner.goto(entryUrl);
      await saveDisplayName(owner, "本机游客");
      const username = `waiting_${gameId.replaceAll("-", "_")}`;
      await registerE2eAccount(ownerContext.request, harness.webUrl, username);
      await owner.reload();
      await owner.getByRole("button", { name: "打开个人资料菜单" }).click();
      await expect(
        owner
          .getByRole("dialog", { name: "个人资料" })
          .getByText(`账号：${username}`),
      ).toBeVisible();
      await saveDisplayName(owner, "Alice 房主");

      await guest.goto(entryUrl);
      await saveDisplayName(guest, "🐷队友");
      await owner.getByTestId("create-room").click();
      await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
      await expect(
        owner.getByRole("heading", { name: "等待玩家加入" }),
      ).toBeVisible();
      const invite = await owner
        .getByTestId("invite-link")
        .getAttribute("href");
      const ownerSlot = await owner.getByTestId("player-slot").innerText();
      if (invite === null) throw new Error("The room invite is missing.");
      await guest.goto(invite);
      await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
      const guestSlot = await guest.getByTestId("player-slot").innerText();
      for (const viewer of [owner, guest]) {
        await expect(
          playerCard(viewer, ownerSlot).getByRole("heading"),
        ).toHaveText("Alice 房主");
        await expect(
          playerCard(viewer, ownerSlot).locator(".player-avatar"),
        ).toHaveText("AL");
        await expect(
          playerCard(viewer, guestSlot).getByRole("heading"),
        ).toHaveText("🐷队友");
        await expect(
          playerCard(viewer, guestSlot).locator(".player-avatar"),
        ).toHaveText("🐷");
        await expect(
          viewer.getByText("稳定席位：", { exact: false }),
        ).toHaveCount(0);
      }
      await expect(
        playerCard(owner, ownerSlot).getByText("你", { exact: true }),
      ).toBeVisible();
      await expect(
        playerCard(guest, guestSlot).getByText("你", { exact: true }),
      ).toBeVisible();

      await owner
        .frameLocator('[data-testid="game-surface-iframe"]')
        .getByRole("button", {
          name: gameId === "pong" ? /^房主在左/ : "房主先手",
        })
        .click();
      await owner.getByTestId("toggle-round-ready").click();
      const longName = "👩‍💻".repeat(24);
      await saveDisplayName(owner, longName);
      for (const viewer of [owner, guest]) {
        await expect(
          playerCard(viewer, ownerSlot).getByRole("heading"),
        ).toHaveText(longName);
        await expect(
          playerCard(viewer, ownerSlot).locator(".player-avatar"),
        ).toHaveText("👩‍💻");
        await expect(
          playerCard(viewer, ownerSlot).getByText("已准备", { exact: true }),
        ).toBeVisible();
      }
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
      ]) {
        await guest.setViewportSize(viewport);
        const card = playerCard(guest, ownerSlot);
        await expect(card.locator(".player-avatar")).toBeVisible();
        const bounds = await card.boundingBox();
        expect(bounds).not.toBeNull();
        if (bounds !== null) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        }
        expect(
          await card
            .getByRole("heading")
            .evaluate((heading) => heading.scrollWidth <= heading.clientWidth),
        ).toBe(true);
      }
      // The global profile menu is hidden in narrow game layouts.
      await guest.setViewportSize({ width: 1280, height: 900 });
      await saveDisplayName(guest, "1a2b🐷你好");
      await expect(
        playerCard(owner, guestSlot).getByRole("heading"),
      ).toHaveText("1a2b🐷你好");
      await expect(
        playerCard(owner, guestSlot).locator(".player-avatar"),
      ).toHaveText("12");
      await guest.setViewportSize({ width: 390, height: 844 });
      await guest.reload();
      await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
      await expect(guest.getByTestId("player-slot")).toHaveText(guestSlot);
      await expect(
        playerCard(guest, guestSlot).getByRole("heading"),
      ).toHaveText("1a2b🐷你好");
      await expect(
        playerCard(guest, ownerSlot).getByRole("heading"),
      ).toHaveText(longName);
      await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
        "取消准备",
      );

      for (const body of [
        { protocolVersion: 6, displayName: "" },
        { protocolVersion: 6, displayName: "a".repeat(25) },
        { protocolVersion: 6, displayName: "name", userId: "forged" },
        { protocolVersion: 6, displayName: "bad\nname" },
      ]) {
        const invalid = await ownerContext.request.post(
          `${harness.webUrl}/api/game-ticket`,
          { data: body },
        );
        expect(invalid.status()).toBe(400);
      }
      for (const protocolVersion of [1, 2, 3, 4, 5]) {
        const retired = await ownerContext.request.post(
          `${harness.webUrl}/api/game-ticket`,
          {
            data: { protocolVersion },
          },
        );
        expect(retired.status()).toBe(400);
        expect(retired.headers()["cache-control"]).toBe("no-store, private");
        expect(await retired.json()).toEqual({
          code: "PROTOCOL_VERSION_UNSUPPORTED",
        });
      }
      for (const data of [undefined, {}]) {
        const missing = await ownerContext.request.post(
          `${harness.webUrl}/api/game-ticket`,
          { data },
        );
        expect(missing.status()).toBe(400);
        expect(await missing.json()).toEqual({
          code: "INVALID_TICKET_REQUEST",
        });
      }
      await owner.getByTestId("close-room").click();
      await expect(owner.getByTestId("create-room")).toBeVisible();
    } finally {
      await Promise.all([ownerContext.close(), guestContext.close()]);
    }
  });
}
