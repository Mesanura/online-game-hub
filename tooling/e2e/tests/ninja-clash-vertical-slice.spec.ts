import { expect, test, type Page } from "@playwright/test";
import {
  createPostgresDatabaseClient,
  PostgresRealtimeRoomStore,
  PostgresRealtimeReplayStore,
  PostgresRealtimeMatchRepository,
} from "@online-game-hub/database";
import {
  defineRealtimePlayerSlotId,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";
import { registerE2eAccount } from "../src/account.js";
import { closeGameHud } from "../src/game-hud.js";
let harness: E2eHarness;
test.beforeAll(async () => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
});
test.afterAll(async () => {
  await harness?.stop();
});
const surface = (page: Page) =>
  page.frameLocator('[data-testid="game-surface-iframe"]');
test("two accounts score three rounds, reconnect and reuse target settings", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    }),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const owner = required(pages[0]),
    guest = required(pages[1]);
  const errors: string[] = [];
  for (const page of pages) page.on("pageerror", (e) => errors.push(e.message));
  const db = createPostgresDatabaseClient({
      url: harness.databaseUrl,
      applicationName: "ninja-e2e",
      maxConnections: 2,
    }),
    rooms = new PostgresRealtimeRoomStore(db.database),
    replays = new PostgresRealtimeReplayStore(db.database);
  try {
    await Promise.all(
      pages.map((p, i) =>
        registerE2eAccount(p.request, harness.webUrl, "ninja_account_" + i),
      ),
    );
    await owner.goto(harness.webUrl + "/games/ninja-clash");
    await owner.getByTestId("create-room").click();
    await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
    await surface(owner).locator('#targets [data-value="3"]').click();
    await expect(surface(owner).locator("#confirmed")).toContainText("3 分");
    const invite = required(
      await owner.getByTestId("invite-link").getAttribute("href"),
    );
    await guest.goto(invite);
    await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
    await expect(
      surface(guest).locator('#targets [data-value="5"]'),
    ).toBeDisabled();
    await owner.screenshot({
      path: info.outputPath("ninja-setup.png"),
      fullPage: true,
    });
    for (const page of pages)
      await page.getByTestId("toggle-round-ready").click();
    for (const page of pages)
      await expect(surface(page).locator("#stage canvas")).toBeVisible();
    const code = required(new URL(invite).pathname.split("/").at(-1));
    const room = required(await rooms.getByRoomCode(code));
    const replayId = required(room.currentRound).replayId;
    const definition = required(
      resolveRealtimeGameDefinition(room.gameId, room.gameVersion),
    );
    const ownerSlotId = defineRealtimePlayerSlotId(
      required(room.currentRound?.playerOrder[0]),
    );
    interface PublicView {
      phase: string;
      players: { index: number; x: number; y: number }[];
    }
    // Advancing the manual scheduler only queues work. Wait for the committed
    // tick, then for the iframe to render that tick's projected coordinates.
    // Reading immediately after advance can observe the previous snapshot and
    // queue another movement batch, running past the opponent on slower runners.
    async function advance(ticks: number): Promise<PublicView> {
      const target =
        Number(await owner.getByTestId("server-tick").textContent()) + ticks;
      harness.advanceRealtimeTicks(ticks);
      await expect
        .poll(
          async () => {
            const current = Number(
              await owner.getByTestId("server-tick").textContent(),
            );
            return (
              current >= target ||
              ((await owner
                .getByTestId("match-status")
                .getAttribute("data-status")) === "completed" &&
                current === (await replays.get(replayId))?.finalTick)
            );
          },
          { timeout: 30000, intervals: [10, 25, 50, 100] },
        )
        .toBe(true);
      const finalTick = Number(
        await owner.getByTestId("server-tick").textContent(),
      );
      // The runtime commits replay and room persistence before publishing a snapshot.
      const record = required(await replays.get(replayId));
      const rebuilt = verifyRealtimeReplay(
        {
          ...record,
          finalTick,
          recordedOutcome: null,
          recordedRngCursor: null,
        },
        resolveRealtimeGameDefinition,
      );
      expect(rebuilt.ok).toBe(true);
      if (!rebuilt.ok) throw new Error(rebuilt.code);
      const view = definition.projectView({
        state: rebuilt.result.state,
        viewer: { kind: "player", slotId: ownerSlotId },
      }) as unknown as PublicView;
      await expect
        .poll(() =>
          surface(owner)
            .locator("#root")
            .evaluate((root) => ({
              phase: root.getAttribute("data-phase"),
              players: [...root.querySelectorAll(".score")].map((score) => ({
                x: Number(score.getAttribute("data-x")),
                y: Number(score.getAttribute("data-y")),
              })),
            })),
        )
        .toEqual({
          phase: view.phase,
          players: view.players.map(({ x, y }) => ({ x, y })),
        });
      return view;
    }
    async function pressAndWaitForInput(
      action: () => Promise<void>,
      expected: unknown,
    ) {
      const previousSequence =
        (await replays.get(replayId))?.events.at(-1)?.sequence ?? 0;
      await action();
      await expect
        .poll(async () => {
          await advance(1);
          return (await replays.get(replayId))?.events
            .filter(
              (event) =>
                event.sequence > previousSequence &&
                event.actorSlotId === ownerSlotId,
            )
            .map((event) => event.input);
        })
        .toContainEqual(expected);
    }
    for (let round = 1; round <= 3; round++) {
      let currentView = await advance(180);
      await expect(surface(owner).locator("#root")).toHaveAttribute(
        "data-phase",
        "ACTIVE",
      );
      await closeGameHud(owner);
      await surface(owner).locator("#stage").click();
      const x0 = required(currentView.players[0]).x,
        x1 = required(currentView.players[1]).x;
      const key = x0 < x1 ? "KeyD" : "KeyA";
      await owner.keyboard.down(key);
      await expect
        .poll(
          async () => {
            const a = required(currentView.players[0]).x,
              b = required(currentView.players[1]).x;
            currentView = await advance(Math.abs(a - b) > 6000 ? 9 : 1);
            return (
              Math.abs(
                required(currentView.players[0]).x -
                  required(currentView.players[1]).x,
              ) <= 3300
            );
          },
          { timeout: 45000, intervals: [0] },
        )
        .toBe(true);
      await pressAndWaitForInput(() => owner.keyboard.up(key), {
        type: "MOVE",
        direction: 0,
      });
      const stoppedX = Number(
        await surface(owner).locator("#score-0").getAttribute("data-x"),
      );
      const distance = (x1 - stoppedX) * (key === "KeyD" ? 1 : -1);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(3300);
      await pressAndWaitForInput(() => owner.keyboard.press("KeyJ"), {
        type: "ATTACK",
      });
      await advance(5);
      if (round < 3) {
        await expect(surface(owner).locator("#root")).toHaveAttribute(
          "data-phase",
          "COUNTDOWN",
        );
        await expect(surface(owner).locator("#score-0")).toContainText(
          round + " / 3",
        );
        if (round === 1) {
          await guest.reload();
          await expect(guest.getByTestId("connection-state")).toHaveText(
            "已连接",
          );
          await expect(surface(guest).locator("#score-0")).toContainText(
            "1 / 3",
          );
        }
      }
    }
    await expect(owner.getByTestId("match-status")).toHaveText("对局已完成");
    const completed = await replays.get(replayId);
    expect(
      verifyRealtimeReplay(completed, resolveRealtimeGameDefinition).ok,
    ).toBe(true);
    expect(completed?.recordedOutcome).toMatchObject({
      type: "WIN",
      reason: "TARGET_SCORE",
    });
    await owner.screenshot({
      path: info.outputPath("ninja-result.png"),
      fullPage: true,
    });
    const accounts = room.players.filter((p) => p.userId !== null);
    for (const p of accounts)
      expect(
        await new PostgresRealtimeMatchRepository(
          db.database,
        ).listForUserWithResults(required(p.userId)),
      ).toHaveLength(1);
    for (const page of pages) {
      await page.getByTestId("rematch-game").click();
    }
    await expect(surface(owner).locator("#banner-title")).toHaveText("3");
    expect(
      (await rooms.getByRoomCode(code))?.previousFinalizedSetup?.config,
    ).toEqual({ playerCount: 2, targetScore: 3 });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await db.close();
  }
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
