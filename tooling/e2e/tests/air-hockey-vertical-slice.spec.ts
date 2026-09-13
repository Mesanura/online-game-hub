import { expect, test, type Page } from "@playwright/test";
import {
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  PostgresRealtimeMatchRepository,
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
async function scores(page: Page): Promise<[number, number]> {
  return [
    Number(await surface(page).getByTestId("score-blue").textContent()),
    Number(await surface(page).getByTestId("score-orange").textContent()),
  ];
}
async function advance(page: Page, count: number) {
  const tick = Number(await page.getByTestId("server-tick").textContent());
  harness.advanceRealtimeTicks(count);
  await expect
    .poll(
      async () =>
        (await page.getByTestId("match-status").getAttribute("data-status")) ===
          "completed" ||
        Number(await page.getByTestId("server-tick").textContent()) >=
          tick + count,
    )
    .toBe(true);
}
async function point(page: Page, x: number, y: number) {
  const box = await surface(page).locator("#court-canvas canvas").boundingBox();
  if (!box) throw new Error("Missing air hockey canvas.");
  return {
    x: box.x + ((12 + (x * 600) / 10000) / 624) * box.width,
    y: box.y + ((12 + (y * 1020) / 10000) / 1044) * box.height,
  };
}

test("two accounts play air hockey, reconnect, finish by score and rematch with durable private history", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const contextA = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  let owner = await contextA.newPage();
  const guest = await contextB.newPage();
  const errors: string[] = [];
  const watch = (page: Page) =>
    page.on("pageerror", (error) => errors.push(error.message));
  watch(owner);
  watch(guest);
  const database = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "air-hockey-e2e",
    maxConnections: 2,
  });
  const roomStore = new PostgresRealtimeRoomStore(database.database);
  const replayStore = new PostgresRealtimeReplayStore(database.database);
  try {
    await Promise.all([
      registerE2eAccount(owner.request, harness.webUrl, "hockey_account_a"),
      registerE2eAccount(guest.request, harness.webUrl, "hockey_account_b"),
    ]);
    await owner.goto(`${harness.webUrl}/games/air-hockey`);
    await owner.getByTestId("create-room").click();
    await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
    const invite = await owner.getByTestId("invite-link").getAttribute("href");
    if (!invite) throw new Error("Missing air hockey invite.");
    const roomCode = new URL(invite).pathname.split("/").at(-1) ?? "";
    await guest.goto(invite);
    await expect(guest.getByTestId("connection-state")).toHaveText("已连接");
    await expect(surface(guest).locator('[data-score="5"]')).toBeDisabled();
    await owner.getByTestId("toggle-round-ready").click();
    await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
      "取消准备",
    );
    for (const targetScore of [11, 5]) {
      await surface(owner).locator(`[data-score="${targetScore}"]`).click();
      await expect(
        surface(guest).locator(`[data-score="${targetScore}"]`),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await expect(owner.getByTestId("toggle-round-ready")).toHaveText(
      "准备开始",
    );
    await owner.screenshot({ path: info.outputPath("air-hockey-setup.png") });
    await owner.getByTestId("toggle-round-ready").click();
    await guest.getByTestId("toggle-round-ready").click();
    for (const page of [owner, guest]) {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/air-hockey/1.0.0/play/index.html",
      );
      await expect(surface(page).locator("#court-canvas canvas")).toBeVisible();
    }
    const slotA = (
      await owner.getByTestId("player-slot").textContent()
    )?.trim();
    const slotB = (
      await guest.getByTestId("player-slot").textContent()
    )?.trim();
    expect(slotA).toBeTruthy();
    expect(slotB).toBeTruthy();
    expect(slotA).not.toBe(slotB);
    await expect(surface(owner).locator("#blue-label")).toContainText("你");
    await expect(surface(guest).locator("#orange-label")).toContainText("你");
    await expect(surface(owner).locator("#phase-label")).toContainText(
      "由你开球",
    );
    await expect(surface(guest).locator("#phase-label")).toHaveText(
      "等待对方开球",
    );
    await owner.screenshot({
      path: info.outputPath("air-hockey-owner-play.png"),
    });
    await guest.screenshot({
      path: info.outputPath("air-hockey-guest-mobile.png"),
    });
    const firstRoom = await roomStore.getByRoomCode(roomCode);
    const firstReplayId = firstRoom?.currentRound?.replayId;
    if (!firstReplayId) throw new Error("Missing persisted air hockey round.");
    let activeReplayId = firstReplayId;
    const touch = await contextB.newCDPSession(guest);
    let touching = false;
    async function move(side: 0 | 1, x: number, y: number) {
      const page = side === 0 ? owner : guest;
      const slot = side === 0 ? slotA : slotB;
      const before =
        (await replayStore.get(activeReplayId))?.events.length ?? 0;
      const target = await point(page, x, y);
      if (side === 0) {
        await page.mouse.move(target.x + 1, target.y);
        await page.mouse.move(target.x, target.y);
      } else {
        if (touching)
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        const start = await point(page, x, 7500);
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ id: 1, ...start }],
        });
        touching = true;
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 1, ...target }],
        });
      }
      await expect
        .poll(async () => {
          harness.advanceRealtimeTicks(1);
          const record = await replayStore.get(activeReplayId);
          return record?.events.slice(before).some((event) => {
            const input = event.input as {
              type: string;
              target: { x: number; y: number } | null;
            };
            return (
              event.actorSlotId === slot &&
              input.type === "CONTROL" &&
              input.target !== null &&
              Math.abs(input.target.x - x) <= 40 &&
              Math.abs(input.target.y - y) <= 40
            );
          });
        })
        .toBe(true);
    }
    await advance(owner, 120);
    expect(await scores(owner)).toEqual([0, 0]);
    await move(1, 5000, 5000);
    await advance(owner, 35);
    await expect(surface(owner).locator("#root")).toHaveAttribute(
      "data-phase",
      "SERVE",
    );
    expect(await scores(owner)).toEqual([0, 0]);

    async function playPoint() {
      const before = await scores(owner);
      const servingSide = (
        await surface(owner).locator("#phase-label").textContent()
      )?.includes("由你开球")
        ? 0
        : 1;
      await move(servingSide === 0 ? 1 : 0, 700, 7500);
      await move(servingSide, 5000, 7500);
      await advance(owner, 20);
      await move(servingSide, 5000, 5000);
      // Native pointer quantization can change the contact angle. Let the
      // authoritative rally finish, and stop ticking at the first score so a
      // burst of the manual clock cannot outrun the Surface's rally reset.
      for (let batch = 0; batch < 80; batch++) {
        await advance(owner, 6);
        await expect
          .poll(async () =>
            Number(
              await surface(owner).locator("#root").getAttribute("data-tick"),
            ),
          )
          .toBe(Number(await owner.getByTestId("server-tick").textContent()));
        const current = await scores(owner);
        if (current[0] + current[1] > before[0] + before[1]) break;
      }
      const after = await scores(owner);
      expect(after[0] + after[1]).toBe(before[0] + before[1] + 1);
      await expect.poll(() => scores(guest)).toEqual(after);
      return after;
    }
    const firstScore = await playPoint();
    await owner.close();
    owner = await contextA.newPage();
    watch(owner);
    await owner.goto(invite);
    await expect(owner.getByTestId("connection-state")).toHaveText("已连接");
    await expect(owner.getByTestId("player-slot")).toHaveText(slotA ?? "");
    await expect.poll(() => scores(owner)).toEqual(firstScore);
    await expect(surface(owner).locator("#blue-label")).toContainText("你");
    await expect(surface(owner).locator("#target-score")).toHaveText(
      "先到 5 分",
    );
    for (let i = 0; i < 8 && Math.max(...(await scores(owner))) < 5; i++)
      await playPoint();
    await expect(owner.getByTestId("match-status")).toHaveText("对局已完成");
    await expect(guest.getByTestId("match-status")).toHaveText("对局已完成");
    const finalScore = await scores(owner);
    expect(Math.max(...finalScore)).toBe(5);
    const firstRecord = await replayStore.get(firstReplayId);
    expect(firstRecord?.header.initialConfig).toEqual({ targetScore: 5 });
    expect(firstRecord?.header.players.map((player) => player.slotId)).toEqual([
      slotA,
      slotB,
    ]);
    expect(firstRecord?.recordedOutcome).toMatchObject({
      reason: "SCORE",
      scores: finalScore,
    });
    expect(firstRecord?.recordedRngCursor).toBe(0);
    expect(
      verifyRealtimeReplay(firstRecord, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    await owner.screenshot({
      path: info.outputPath("air-hockey-completed.png"),
    });
    const history = await owner.request.get(`${harness.webUrl}/api/matches`);
    expect(history.status()).toBe(200);
    const matches = (await history.json()) as {
      matches: { matchId: string; gameId: string; replayAvailable: boolean }[];
    };
    const match = matches.matches.find((row) => row.gameId === "air-hockey");
    if (!match) throw new Error("Missing private air hockey history.");
    expect(match.replayAvailable).toBe(false);
    const playback = await owner.request.get(
      `${harness.webUrl}/api/matches/${encodeURIComponent(match.matchId)}/replay`,
    );
    expect(playback.status()).toBe(409);
    expect(await playback.json()).toEqual({
      code: "PLAYER_PLAYBACK_NOT_SUPPORTED",
    });

    await owner.getByTestId("rematch-game").click();
    await expect(owner.getByTestId("match-status")).toHaveText("对局已完成");
    await guest.getByTestId("rematch-game").click();
    for (const page of [owner, guest]) {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect.poll(() => scores(page)).toEqual([0, 0]);
    }
    const nextRoom = await roomStore.getByRoomCode(roomCode);
    expect(nextRoom?.currentRound?.playerOrder).toEqual([slotA, slotB]);
    expect(nextRoom?.previousFinalizedSetup?.config).toEqual({
      targetScore: 5,
    });
    const nextReplayId = nextRoom?.currentRound?.replayId;
    if (!nextReplayId) throw new Error("Missing rematch record.");
    expect(nextReplayId).not.toBe(firstReplayId);
    activeReplayId = nextReplayId;
    await expect(surface(owner).locator("#phase-label")).toContainText(
      "由你开球",
    );
    const beforeResign = await playPoint();
    await openGameHud(owner);
    await advance(owner, 2);
    owner.once("dialog", (dialog) => void dialog.dismiss());
    await owner.getByTestId("resign-game").click();
    expect(
      (await replayStore.get(nextReplayId))?.events.some(
        (event) => (event.input as { type: string }).type === "RESIGN",
      ),
    ).toBe(false);
    owner.once("dialog", (dialog) => void dialog.accept());
    await owner.getByTestId("resign-game").click();
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return owner.getByTestId("match-status").textContent();
      })
      .toBe("对局已完成");
    const resignation = await replayStore.get(nextReplayId);
    expect(resignation?.recordedOutcome).toMatchObject({
      reason: "RESIGNATION",
      winnerSlotId: slotB,
      resignedSlotId: slotA,
      scores: beforeResign,
    });
    expect(
      resignation?.events.filter(
        (event) => (event.input as { type: string }).type === "RESIGN",
      ),
    ).toHaveLength(1);
    expect(resignation?.header.rng.seed).not.toBe(firstRecord?.header.rng.seed);
    expect(
      verifyRealtimeReplay(resignation, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    await closeGameHud(owner);
    await expect(surface(owner).locator("#phase-label")).toHaveText("对手获胜");
    const reader = createPostgresDatabaseClient({
      url: harness.databaseUrl,
      applicationName: "air-hockey-cross-connection",
    });
    try {
      const stored = await new PostgresRealtimeRoomStore(
        reader.database,
      ).getByRoomCode(roomCode);
      expect(stored?.previousFinalizedSetup?.config).toEqual({
        targetScore: 5,
      });
      expect(
        await new PostgresRealtimeReplayStore(reader.database).get(
          nextReplayId,
        ),
      ).toEqual(resignation);
      const participants =
        stored?.players.filter(
          (slot) => slot.userId !== undefined && slot.userId !== null,
        ) ?? [];
      expect(participants).toHaveLength(2);
      const repository = new PostgresRealtimeMatchRepository(reader.database);
      for (const [side, participant] of participants.entries()) {
        if (!participant.userId) throw new Error("Missing account snapshot.");
        const rows = await repository.listForUserWithResults(
          participant.userId,
        );
        expect(rows).toHaveLength(2);
        const latest = rows.find((row) => row.roundNumber === 2);
        if (!latest) throw new Error("Missing rematch history.");
        expect(projectMatchHistoryResult(latest)).toEqual({
          kind: "score",
          own: beforeResign[side],
          opponent: beforeResign[side === 0 ? 1 : 0],
        });
      }
    } finally {
      await reader.close();
    }
    await touch.detach();
    expect(errors).toEqual([]);
  } finally {
    await database.close();
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
