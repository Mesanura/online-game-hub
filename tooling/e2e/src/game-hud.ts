import type { Page } from "@playwright/test";

export async function openGameHud(page: Page): Promise<void> {
  const closeButton = page.getByTestId("close-game-hud");
  if (await closeButton.isVisible()) {
    return;
  }
  const toggle = page.getByTestId("toggle-game-hud");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await closeButton.waitFor({ state: "visible" });
}

export async function closeGameHud(page: Page): Promise<void> {
  const closeButton = page.getByTestId("close-game-hud");
  if (await closeButton.isVisible()) {
    await closeButton.click();
  }
  await closeButton.waitFor({ state: "hidden" });
}
