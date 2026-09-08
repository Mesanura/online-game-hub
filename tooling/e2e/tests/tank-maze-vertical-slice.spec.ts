import { expect, test, type Page } from "@playwright/test";
import {
  PostgresRealtimeRoomStore,
  PostgresRealtimeReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyRealtimeReplay } from "@online-game-hub/realtime-game-sdk";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";
import { registerE2eAccount } from "../src/account.js";
import { openGameHud, closeGameHud } from "../src/game-hud.js";
let harness: E2eHarness;
test.beforeAll(async () => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
});
test.afterAll(async () => {
  await harness?.stop();
});
const surface = (page: Page) =>
  page.frameLocator('[data-testid="game-surface-iframe"]');
test("eight browsers play SVG tanks with keyboard/touch, reconnect and persist a complete match", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      browser.newContext(
        i === 1
          ? { hasTouch: true, viewport: { width: 390, height: 844 } }
          : { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" },
      ),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage())),
    errors: string[] = [];
  pages.forEach((p) => p.on("pageerror", (e) => errors.push(e.message)));
  const db = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "tank-maze-e2e",
    maxConnections: 2,
  });
  const rooms = new PostgresRealtimeRoomStore(db.database),
    replays = new PostgresRealtimeReplayStore(db.database);
  try {
    const a = required(pages[0]),
      b = required(pages[1]);
    await registerE2eAccount(a.request, harness.webUrl, "tank_account_a");
    await registerE2eAccount(b.request, harness.webUrl, "tank_account_b");
    await a.goto(harness.webUrl + "/games/tank-maze");
    await a.getByTestId("create-room").click();
    await expect(a.getByTestId("connection-state")).toHaveText("已连接");
    await surface(a).locator('[data-setting="count"]').selectOption("8");
    await surface(a).locator('[data-color="7"]').click();
    const invite = await a.getByTestId("invite-link").getAttribute("href");
    if (invite === null) throw new Error("Missing invitation");
    const roomCode = required(new URL(invite).pathname.split("/").at(-1));
    for (const page of pages.slice(1)) {
      await page.goto(invite);
      await expect(page.getByTestId("connection-state")).toHaveText("已连接");
    }
    await expect(surface(a).locator(".roster")).toContainText("8 / 8");
    await a.screenshot({ path: info.outputPath("tank-setup.png") });
    for (const page of pages)
      await page.getByTestId("toggle-round-ready").click();
    for (const page of pages) {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(surface(page).locator("#arena")).toBeVisible();
      await expect(surface(page).locator(".score")).toHaveCount(8);
    }
    const room = await rooms.getByRoomCode(roomCode),
      replayId = room?.currentRound?.replayId;
    if (replayId === undefined)
      throw new Error("Eight-player round missing from PostgreSQL");
    expect(room?.currentRound?.playerOrder).toHaveLength(8);
    harness.advanceRealtimeTicks(180);
    await expect
      .poll(() => surface(a).locator("#phase").textContent(), {
        timeout: 30000,
      })
      .not.toContain("准备");
    await a.screenshot({ path: info.outputPath("tank-desktop.png") });
    await b.screenshot({ path: info.outputPath("tank-mobile.png") });
    await surface(a).locator("#arena").click();
    await a.keyboard.press("Space");
    await a.keyboard.down("KeyW");
    await a.keyboard.down("KeyD");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events.map((e) => e.input);
      })
      .toContainEqual({ type: "FIRE" });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events.map((e) => e.input);
      })
      .toContainEqual({ type: "MOVE", move: 1, turn: 1 });
    await a.keyboard.up("KeyW");
    await a.keyboard.up("KeyD");
    const touch = await required(contexts[1]).newCDPSession(b);
    const points = await Promise.all(
      ["up", "left", "fire"].map(async (control, i) => {
        const box = await surface(b)
          .locator('[data-control="' + control + '"]')
          .boundingBox();
        if (box === null) throw new Error("Missing touch control");
        expect(box.width).toBeGreaterThanOrEqual(44);
        return {
          id: i + 1,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          radiusX: 6,
          radiusY: 6,
          force: 1,
        };
      }),
    );
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points,
    });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events.map((e) => e.input);
      })
      .toContainEqual({ type: "MOVE", move: 1, turn: -1 });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replays.get(replayId))?.events.at(-1)?.input;
      })
      .toEqual({ type: "MOVE", move: 0, turn: 0 });
    await touch.detach();
    await surface(a).locator("#sound").click();
    await expect(surface(a).locator("#sound")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await a.reload();
    await expect(a.getByTestId("connection-state")).toHaveText("已连接");
    await expect(surface(a).locator(".score")).toHaveCount(8);
    for (const page of pages.slice(1)) {
      await openGameHud(page);
      page.once("dialog", (d) => {
        void d.accept();
      });
      await page.getByTestId("resign-game").click();
      harness.advanceRealtimeTicks(1);
    }
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return a.getByTestId("match-status").textContent();
      })
      .toBe("对局已完成");
    const record = await replays.get(replayId);
    expect(verifyRealtimeReplay(record, resolveRealtimeGameDefinition).ok).toBe(
      true,
    );
    expect(record?.header.players).toHaveLength(8);
    const fresh = createPostgresDatabaseClient({
      url: harness.databaseUrl,
      applicationName: "tank-maze-reread",
      maxConnections: 1,
    });
    try {
      expect(
        (
          await new PostgresRealtimeRoomStore(fresh.database).getByRoomCode(
            roomCode,
          )
        )?.currentRound?.playerOrder,
      ).toHaveLength(8);
    } finally {
      await fresh.close();
    }
    for (const page of pages) {
      await closeGameHud(page);
      await page.getByTestId("rematch-game").click({ timeout: 10000 });
    }
    await expect(a.getByTestId("round-number")).toHaveText("第 2 局");
    expect(
      (await rooms.getByRoomCode(roomCode))?.previousFinalizedSetup?.config,
    ).toMatchObject({ playerCount: 8, targetScore: 10 });
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    await db.close();
  }
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
