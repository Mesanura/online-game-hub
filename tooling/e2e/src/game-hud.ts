import type { Page } from "@playwright/test";

export async function openGameHud(page: Page): Promise<void> {
  const toggle = page.getByTestId("toggle-game-hud");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await page.getByTestId("close-game-hud").waitFor({ state: "visible" });
}
