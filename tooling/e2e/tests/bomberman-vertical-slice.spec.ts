import { expect, test, type Page } from "@playwright/test";
import {
  PostgresRealtimeMatchRepository,
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { projectMatchHistoryResult } from "@online-game-hub/game-registry/history";
import { verifyRealtimeReplay } from "@online-game-hub/realtime-game-sdk";
import { registerE2eAccount } from "../src/account.js";
import { closeGameHud, openGameHud } from "../src/game-hud.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;
test.beforeAll(async () => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
});
test.afterAll(async () => {
  await harness?.stop();
});
const surface = (page: Page) =>
  page.frameLocator('[data-testid="game-surface-iframe"]');
async function advance(page: Page, count: number) {
  const target =
    Number(await page.getByTestId("server-tick").textContent()) + count;
  harness.advanceRealtimeTicks(count);
  await expect
    .poll(
      async () =>
        (await page.getByTestId("match-status").getAttribute("data-status")) ===
          "completed" ||
        Number(await page.getByTestId("server-tick").textContent()) >= target,
    )
    .toBe(true);
}
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("Missing Bomberman journey value.");
  return value;
}

test("four accounts play three scored pixel bouts with real multitouch, reconnect and complete the next match", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      browser.newContext(
        i === 1
          ? { hasTouch: true, viewport: { width: 390, height: 844 } }
          : { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" },
      ),
    ),
  );
  const outsiderContext = await browser.newContext();
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const owner = required(pages[0]),
    mobile = required(pages[1]);
  const errors: string[] = [];
  pages.forEach((page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const db = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "bomberman-e2e",
    maxConnections: 2,
  });
  const rooms = new PostgresRealtimeRoomStore(db.database),
    replays = new PostgresRealtimeReplayStore(db.database);
  try {
    await Promise.all(
      pages.map((page, i) =>
        registerE2eAccount(
          page.request,
          harness.webUrl,
          `bomberman_account_${i}`,
        ),
      ),
    );
    await registerE2eAccount(
      outsiderContext.request,
      harness.webUrl,
      "bomberman_outsider",
    );
    await owner.goto(harness.webUrl + "/games");
    await owner
      .locator(".game-card")
      .filter({
        has: owner.getByRole("heading", { name: "像素炸弹人", exact: true }),
      })
      .getByRole("link")
      .click();
    await owner.getByTestId("create-room").click();
    await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
    await expect(surface(owner).locator('[data-count="2"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await surface(owner).locator('[data-count="4"]').click();
    await expect(surface(owner).locator("#confirmed-setting")).toContainText(
      "4 人",
    );
    const invite = required(
      await owner.getByTestId("invite-link").getAttribute("href"),
    );
    const roomCode = required(new URL(invite).pathname.split("/").at(-1));
    for (const page of pages.slice(1)) {
      await page.goto(invite);
      await expect(page.getByTestId("connection-state")).toHaveText("已连接");
      await expect(surface(page).locator('[data-count="4"]')).toBeDisabled();
    }
    await expect(surface(owner).locator(".player-chip")).toHaveCount(4);
    await owner.getByTestId("toggle-round-ready").click();
    await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
      "取消准备",
    );
    await surface(owner).locator('[data-count="3"]').click();
    await expect(surface(mobile).locator("#confirmed-setting")).toContainText(
      "3 人",
    );
    await expect(owner.getByTestId("toggle-round-ready")).toBeDisabled();
    await surface(owner).locator('[data-count="4"]').click();
    await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
      "准备开始",
    );
    await owner.screenshot({
      path: info.outputPath("bomberman-setup.png"),
      fullPage: true,
    });
    for (const page of pages)
      await page.getByTestId("toggle-round-ready").click();
    for (const page of pages) {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/bomberman/1.0.4/play/index.html",
      );
      await expect(surface(page).locator("#arena-canvas canvas")).toBeVisible();
      await expect(surface(page).locator(".score-card")).toHaveCount(4);
      await expect(surface(page).locator("#banner-value")).toHaveText("3");
    }
    const slots = await Promise.all(
      pages.map(async (page) =>
        required(await page.getByTestId("player-slot").textContent()).trim(),
      ),
    );
    expect(new Set(slots).size).toBe(4);
    const firstRoom = required(await rooms.getByRoomCode(roomCode));
    const replayId = required(firstRoom.currentRound?.replayId);
    expect(firstRoom.currentRound?.playerOrder).toEqual(slots);
    expect(firstRoom.previousFinalizedSetup?.config).toEqual({
      mapId: "classic-arena",
      modeId: "classic",
      playerCount: 4,
    });
    await advance(owner, 180);
    for (const page of pages)
      await expect(surface(page).locator("#root")).toHaveAttribute(
        "data-phase",
        "ACTIVE",
      );
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await mobile.setViewportSize(viewport);
      await expect
        .poll(async () => {
          const arena = required(
            await surface(mobile).locator("#arena-canvas canvas").boundingBox(),
          );
          const fullscreen = required(
            await mobile.getByTestId("toggle-game-fullscreen").boundingBox(),
          );
          for (const selector of ["#joystick", "#bomb-button"]) {
            const box = required(
              await surface(mobile).locator(selector).boundingBox(),
            );
            const overlaps = (other: typeof box) =>
              box.x < other.x + other.width &&
              box.x + box.width > other.x &&
              box.y < other.y + other.height &&
              box.y + box.height > other.y;
            if (
              box.width < 44 ||
              box.height < 44 ||
              overlaps(arena) ||
              overlaps(fullscreen)
            )
              return false;
          }
          return (
            Math.abs(arena.width / arena.height - 13 / 11) < 0.01 &&
            arena.y >= 0 &&
            arena.y + arena.height <= viewport.height
          );
        })
        .toBe(true);
      await mobile.screenshot({
        path: info.outputPath(`bomberman-live-${viewport.width}.png`),
      });
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await closeGameHud(owner);
    await surface(owner).locator("#arena-canvas").focus();
    const initialX = Number(
      await surface(owner).getByTestId("player-score-0").getAttribute("data-x"),
    );
    const key = initialX < 7800 ? "KeyD" : "KeyA";
    await owner.keyboard.down(key);
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return Number(
          await surface(owner)
            .getByTestId("player-score-0")
            .getAttribute("data-x"),
        );
      })
      .not.toBe(initialX);
    await owner.keyboard.up(key);
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events
          .filter((event) => event.actorSlotId === slots[0])
          .at(-1)?.input;
      })
      .toEqual({ type: "MOVE", direction: "none" });

    const cdp = await required(contexts[1]).newCDPSession(mobile);
    const stick = required(
      await surface(mobile).locator("#joystick").boundingBox(),
    );
    const bomb = required(
      await surface(mobile).locator("#bomb-button").boundingBox(),
    );
    const mobileX = Number(
      await surface(mobile)
        .getByTestId("player-score-1")
        .getAttribute("data-x"),
    );
    const mobileDirection = mobileX < 7800 ? "right" : "left";
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          id: 1,
          x:
            stick.x +
            stick.width / 2 +
            (mobileDirection === "right" ? 30 : -30),
          y: stick.y + stick.height / 2,
          radiusX: 5,
          radiusY: 5,
          force: 1,
        },
        {
          id: 2,
          x: bomb.x + bomb.width / 2,
          y: bomb.y + bomb.height / 2,
          radiusX: 5,
          radiusY: 5,
          force: 1,
        },
      ],
    });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events
          .filter((event) => event.actorSlotId === slots[1])
          .map((event) => event.input);
      })
      .toEqual(
        expect.arrayContaining([
          { type: "MOVE", direction: mobileDirection },
          { type: "PLACE_BOMB" },
        ]),
      );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events
          .filter((event) => event.actorSlotId === slots[1])
          .at(-1)?.input;
      })
      .toEqual({ type: "MOVE", direction: "none" });
    await cdp.detach();

    for (let bout = 1; bout <= 3; bout++) {
      if (bout > 1) {
        await advance(owner, 300);
        for (const page of pages) {
          await expect(surface(page).locator("#root")).toHaveAttribute(
            "data-bout",
            String(bout),
          );
          await expect(surface(page).locator("#root")).toHaveAttribute(
            "data-phase",
            "ACTIVE",
          );
          await expect(
            surface(page).locator('.score-card[data-alive="true"]'),
          ).toHaveCount(4);
        }
      }
      for (let i = 0; i < 3; i++) {
        if (bout === 1 && i === 1) continue;
        const page = required(pages[i]);
        await closeGameHud(page);
        if (i === 1) await surface(page).locator("#bomb-button").tap();
        else {
          await surface(page).locator("#arena-canvas").focus();
          await page.keyboard.press("Space");
        }
        await expect
          .poll(async () => {
            harness.advanceRealtimeTicks(1);
            return (await replays.get(replayId))?.events.filter(
              (event) =>
                event.actorSlotId === slots[i] &&
                (event.input as { type: string }).type === "PLACE_BOMB",
            ).length;
          })
          .toBe(bout);
      }
      await advance(owner, 160);
      for (const page of pages) {
        await expect(
          surface(page).getByTestId("player-score-3").locator(".player-score"),
        ).toHaveText(String(bout));
        await expect(surface(page).locator("#root")).toHaveAttribute(
          "data-phase",
          bout === 3 ? "COMPLETE" : "RESULT",
        );
      }
      if (bout === 1) {
        await owner.reload();
        await expect(owner.getByTestId("connection-state")).toHaveText(
          "已连接",
        );
        await expect(owner.getByTestId("player-slot")).toHaveText(
          required(slots[0]),
        );
        await expect(
          surface(owner).getByTestId("player-score-3").locator(".player-score"),
        ).toHaveText("1");
      }
    }
    const completed = required(await replays.get(replayId));
    expect(completed.recordedOutcome).toMatchObject({
      type: "WIN",
      reason: "SCORE",
      winnerSlotId: slots[3],
    });
    expect(
      verifyRealtimeReplay(completed, resolveRealtimeGameDefinition).ok,
    ).toBe(true);
    expect(
      completed.events.filter(
        (event) => (event.input as { type: string }).type === "PLACE_BOMB",
      ),
    ).toHaveLength(9);
    for (let i = 0; i < pages.length; i++) {
      const page = required(pages[i]);
      await expect(page.getByTestId("match-status")).toHaveText("对局已完成");
      const response = await page.request.get(harness.webUrl + "/api/matches");
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toMatchObject({
        gameId: "bomberman",
        replayAvailable: false,
        result: { kind: "win-loss", value: i === 3 ? "win" : "loss" },
      });
      for (const key of [
        "seed",
        "input",
        "rng",
        "hiddenPickups",
        "playerSessionId",
      ])
        expect(JSON.stringify(result)).not.toContain(`"${key}"`);
      const playback = await page.request.get(
        `${harness.webUrl}/api/matches/${result.matches[0].matchId}/replay`,
      );
      expect(playback.status()).toBe(409);
      const denied = await outsiderContext.request.get(
        `${harness.webUrl}/api/matches/${result.matches[0].matchId}/replay`,
      );
      expect(denied.status()).toBe(404);
    }
    expect(
      await (
        await outsiderContext.request.get(harness.webUrl + "/api/matches")
      ).json(),
    ).toEqual({ matches: [] });
    await owner.screenshot({
      path: info.outputPath("bomberman-match-result.png"),
    });
    for (const page of pages.slice(0, 3))
      await page.getByTestId("rematch-game").click();
    await expect(owner.getByTestId("match-status")).toHaveText("对局已完成");
    await required(pages[3]).getByTestId("rematch-game").click();
    for (const page of pages) {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(surface(page).locator(".player-score")).toHaveText([
        "0",
        "0",
        "0",
        "0",
      ]);
    }
    const nextRoom = required(await rooms.getByRoomCode(roomCode));
    const nextReplayId = required(nextRoom.currentRound?.replayId);
    expect(nextReplayId).not.toBe(replayId);
    expect(nextRoom.previousFinalizedSetup).toEqual(
      firstRoom.previousFinalizedSetup,
    );
    await openGameHud(owner);
    owner.once("dialog", (dialog) => void dialog.dismiss());
    await owner.getByTestId("resign-game").click();
    await advance(owner, 1);
    expect((await replays.get(nextReplayId))?.events).toEqual([]);
    for (const page of pages.slice(0, 3)) {
      await openGameHud(page);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByTestId("resign-game").click();
      await expect
        .poll(async () => {
          harness.advanceRealtimeTicks(1);
          const slot = (
            await page.getByTestId("player-slot").textContent()
          )?.trim();
          return (await replays.get(nextReplayId))?.events.some(
            (event) =>
              event.actorSlotId === slot &&
              (event.input as { type: string }).type === "RESIGN",
          );
        })
        .toBe(true);
    }
    await expect(owner.getByTestId("match-status")).toHaveText("对局已完成");
    const resignation = required(await replays.get(nextReplayId));
    expect(resignation.recordedOutcome).toMatchObject({
      reason: "RESIGNATION",
      winnerSlotId: slots[3],
    });
    expect(resignation.header.rng.seed).not.toBe(completed.header.rng.seed);
    expect(
      verifyRealtimeReplay(resignation, resolveRealtimeGameDefinition).ok,
    ).toBe(true);
    const reader = createPostgresDatabaseClient({
      url: harness.databaseUrl,
      applicationName: "bomberman-cross-connection",
      maxConnections: 1,
    });
    try {
      const persisted = required(
        await new PostgresRealtimeRoomStore(reader.database).getByRoomCode(
          roomCode,
        ),
      );
      const replayReader = new PostgresRealtimeReplayStore(reader.database);
      expect(await replayReader.get(replayId)).toEqual(completed);
      expect(await replayReader.get(nextReplayId)).toEqual(resignation);
      const history = new PostgresRealtimeMatchRepository(reader.database);
      for (const [index, player] of persisted.players.entries()) {
        const rows = await history.listForUserWithResults(
          required(player.userId),
        );
        expect(rows).toHaveLength(2);
        for (const row of rows)
          expect(projectMatchHistoryResult(row)).toEqual({
            kind: "win-loss",
            value: index === 3 ? "win" : "loss",
          });
      }
    } finally {
      await reader.close();
    }
    for (const i of [0, 3]) {
      const page = required(pages[i]);
      await page.goto(harness.webUrl + "/account/matches?game=bomberman");
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(page.locator(".history-result")).toHaveText(
          i === 3 ? ["胜利", "胜利"] : ["失败", "失败"],
        );
        await expect(page.getByRole("link", { name: "进入回放" })).toHaveCount(
          0,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(
      [...contexts, outsiderContext].map((context) => context.close()),
    );
    await db.close();
  }
});
