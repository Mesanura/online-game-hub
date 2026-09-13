import { expect, test } from "@playwright/test";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

test("home and catalog show the same ten games with accurate types and player counts", async ({
  page,
}) => {
  let homeTitles: string[] = [];
  let homeLinks: (string | null)[] = [];
  for (const path of ["/", "/games"]) {
    await page.goto(harness.webUrl + path);
    const cards = page.locator(".game-card");
    await expect(cards).toHaveCount(10);
    const metadata = cards.locator(".game-card-meta");
    await expect(metadata.getByText("回合制", { exact: true })).toHaveCount(6);
    await expect(metadata.getByText("实时对战", { exact: true })).toHaveCount(
      4,
    );
    await expect(metadata.getByText("2 人", { exact: true })).toHaveCount(8);
    await expect(metadata.getByText("2–6 人", { exact: true })).toHaveCount(1);
    await expect(metadata.getByText("2–8 人", { exact: true })).toHaveCount(1);
    const pong = cards.filter({
      has: page.getByRole("heading", { name: "乒乓对战", exact: true }),
    });
    await expect(pong.getByText("实时对战", { exact: true })).toBeVisible();
    await expect(pong.getByRole("link")).toHaveAttribute("href", "/games/pong");
    const titles = await cards.getByRole("heading").allTextContents();
    const links = await cards
      .getByRole("link")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href")),
      );
    if (path === "/") {
      homeTitles = titles;
      homeLinks = links;
    } else {
      expect(titles).toEqual(homeTitles);
      expect(links).toEqual(homeLinks);
      await pong.getByRole("link").click();
      await expect(page).toHaveURL(harness.webUrl + "/games/pong");
      await expect(page.getByTestId("create-room")).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(harness.webUrl + "/games");
      await expect(cards).toHaveCount(10);
    }
  }
});
