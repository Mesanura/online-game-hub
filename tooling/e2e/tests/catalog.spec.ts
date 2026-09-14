import { expect, test } from "@playwright/test";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

test("home and catalog show the same eleven games with accurate types and player counts", async ({
  page,
}) => {
  let homeTitles: string[] = [];
  let homeLinks: (string | null)[] = [];
  for (const path of ["/", "/games"]) {
    await page.goto(harness.webUrl + path);
    const cards = page.locator(".game-card");
    await expect(cards).toHaveCount(11);
    const metadata = cards.locator(".game-card-meta");
    await expect(metadata.getByText("回合制", { exact: true })).toHaveCount(6);
    await expect(metadata.getByText("实时对战", { exact: true })).toHaveCount(
      5,
    );
    await expect(metadata.getByText("2 人", { exact: true })).toHaveCount(8);
    await expect(metadata.getByText("2–6 人", { exact: true })).toHaveCount(1);
    await expect(metadata.getByText("2–8 人", { exact: true })).toHaveCount(1);
    await expect(metadata.getByText("2–4 人", { exact: true })).toHaveCount(1);
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
      await expect(cards).toHaveCount(11);
    }
  }
});

test("catalog combines filters and restores them after refresh and browser back without extra history entries", async ({
  page,
}) => {
  await page.goto(harness.webUrl + "/games");
  const search = page.getByRole("searchbox", { name: "搜索游戏" });
  const runtime = page.getByRole("combobox", { name: "游戏类型" });
  const players = page.getByRole("combobox", { name: "游玩人数" });
  await expect(search).toBeVisible();
  const historyLength = await page.evaluate(() => window.history.length);
  await search.pressSequentially("  坦克  ");
  await runtime.selectOption("realtime");
  await players.selectOption("8");
  await expect(page.locator(".game-card")).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "款游戏" }),
  ).toHaveText("找到 1 / 11 款游戏");
  await expect(search).toHaveValue("  坦克  ");
  expect(new URL(page.url()).searchParams.get("q")).toBe("  坦克  ");
  expect(new URL(page.url()).searchParams.get("runtime")).toBe("realtime");
  expect(new URL(page.url()).searchParams.get("players")).toBe("8");
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);

  await page.reload();
  await expect(search).toHaveValue("  坦克  ");
  await expect(runtime).toHaveValue("realtime");
  await expect(players).toHaveValue("8");
  await page.locator(".game-card").getByRole("link").click();
  await expect(page).toHaveURL(harness.webUrl + "/games/tank-maze");
  await expect(page.getByTestId("create-room")).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("  坦克  ");
  await expect(runtime).toHaveValue("realtime");
  await expect(players).toHaveValue("8");

  await search.fill("没有这样的游戏");
  await expect(
    page.getByRole("heading", { name: "没有匹配的游戏" }),
  ).toBeVisible();
  await expect(page.locator(".game-card")).toHaveCount(0);
  await page.getByRole("button", { name: "查看全部游戏" }).click();
  await expect(page.locator(".game-card")).toHaveCount(11);
  await expect(search).toHaveValue("");
  await expect(runtime).toHaveValue("");
  await expect(players).toHaveValue("");
  await expect(page).toHaveURL(harness.webUrl + "/games");
});

test("catalog respects inclusive player counts and safely ignores invalid query enums", async ({
  page,
}) => {
  await page.goto(harness.webUrl + "/games?runtime=unknown&players=9");
  const runtime = page.getByRole("combobox", { name: "游戏类型" });
  const players = page.getByRole("combobox", { name: "游玩人数" });
  const cards = page.locator(".game-card");
  await expect(cards).toHaveCount(11);
  await expect(runtime).toHaveValue("");
  await expect(players).toHaveValue("");
  for (const [count, expected] of [
    [2, 11],
    [3, 3],
    [4, 3],
    [5, 2],
    [6, 2],
    [7, 1],
    [8, 1],
  ] as const) {
    await players.selectOption(String(count));
    await expect(cards).toHaveCount(expected);
  }
  await runtime.selectOption("turn-based");
  await expect(cards).toHaveCount(0);
  await players.selectOption("6");
  await expect(cards.getByRole("heading")).toHaveText(["中国跳棋"]);
  await runtime.selectOption("realtime");
  await expect(cards.getByRole("heading")).toHaveText(["坦克迷战"]);
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await expect(cards).toHaveCount(11);
  await expect(page).toHaveURL(harness.webUrl + "/games");
});

test("catalog filters fit desktop, tablet and both mobile orientations with keyboard focus", async ({
  page,
}, info) => {
  await page.goto(harness.webUrl + "/games?q=棋");
  const search = page.getByRole("searchbox", { name: "搜索游戏" });
  const runtime = page.getByRole("combobox", { name: "游戏类型" });
  const players = page.getByRole("combobox", { name: "游玩人数" });
  const clear = page.getByRole("button", { name: "清空筛选", exact: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(search).toBeVisible();
    for (const control of [search, runtime, players, clear]) {
      const bounds = await control.boundingBox();
      if (bounds === null) throw new Error("Filter control has no layout box.");
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(runtime).toBeFocused();
    expect(
      await runtime.evaluate(
        (element) => getComputedStyle(element).outlineWidth,
      ),
    ).toBe("3px");
    await page.keyboard.press("Tab");
    await expect(players).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    if (viewport.width === 1440 || viewport.width === 390) {
      await page.screenshot({
        path: info.outputPath(`catalog-${viewport.width}.png`),
        fullPage: true,
      });
    }
  }
});
