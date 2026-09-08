import { expect, test } from "@playwright/test";
import type { FrameLocator, Page, TestInfo } from "@playwright/test";
import {
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyRealtimeReplay } from "@online-game-hub/realtime-game-sdk";

import { registerE2eAccount } from "../src/account.js";
import { openGameHud, closeGameHud } from "../src/game-hud.js";
import { startE2eHarness, type E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

function surface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

function isResign(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    input.type === "RESIGN"
  );
}

test.beforeAll(async () => {
  harness = await startE2eHarness({ manualRealtimeScheduler: true });
});

test.afterAll(async () => {
  await harness?.stop();
});

async function score(page: Page): Promise<readonly [number, number]> {
  return [
    Number(await surface(page).getByTestId("score-left").textContent()),
    Number(await surface(page).getByTestId("score-right").textContent()),
  ];
}

async function advance(page: Page, count: number): Promise<void> {
  const initial = Number(await page.getByTestId("server-tick").textContent());
  harness.advanceRealtimeTicks(count);
  await expect
    .poll(async () => {
      if (
        (await page.getByTestId("match-status").getAttribute("data-status")) ===
        "completed"
      )
        return true;
      return (
        Number(await page.getByTestId("server-tick").textContent()) >=
        initial + count
      );
    })
    .toBe(true);
}

async function expectCourt(page: Page): Promise<void> {
  const canvas = surface(page).locator("#badminton-canvas canvas");
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const target = element as HTMLCanvasElement;
        const context = target.getContext("2d");
        if (context === null || target.width !== 1000 || target.height !== 600)
          return false;
        const colors = [
          [40, 40],
          [500, 345],
          [230, 415],
          [500, 550],
        ].map(([x, y]) =>
          Array.from(context.getImageData(x ?? 0, y ?? 0, 1, 1).data).join(","),
        );
        return new Set(colors).size >= 3;
      }),
    )
    .toBe(true);
  await expect(
    surface(page).getByRole("application", { name: "火柴人羽毛球球场" }),
  ).toBeVisible();
}

async function serve(page: Page): Promise<void> {
  await surface(page).locator("#badminton-canvas").click();
  await page.keyboard.press("KeyS");
  await expect
    .poll(async () => {
      harness.advanceRealtimeTicks(1);
      return surface(page).locator("#root").getAttribute("data-phase");
    })
    .toBe("SERVING");
  await advance(page, 5);
  await expect(surface(page).locator("#root")).toHaveAttribute(
    "data-phase",
    "RALLY",
  );
}

async function serviceLinePixel(page: Page): Promise<number[]> {
  return surface(page)
    .locator("#badminton-canvas canvas")
    .evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("2d");
      if (context === null)
        throw new Error("Missing badminton canvas context.");
      return Array.from(context.getImageData(377, 541, 1, 1).data).slice(0, 3);
    });
}

async function expectLayouts(page: Page, info: TestInfo): Promise<void> {
  for (const viewport of [
    { width: 2560, height: 1440 },
    { width: 1707, height: 960 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(
        async () => {
          const iframe = await page
            .getByTestId("game-surface-iframe")
            .boundingBox();
          const canvas = await surface(page)
            .locator("#badminton-canvas canvas")
            .boundingBox();
          const stage = await surface(page)
            .locator(".court-stage")
            .boundingBox();
          const buttons = await Promise.all(
            (await surface(page).locator("[data-control]").all()).map(
              (button) => button.boundingBox(),
            ),
          );
          const audioToggle = await surface(page)
            .locator(".audio-toggle")
            .boundingBox();
          const fits = await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
                document.documentElement.clientWidth &&
              document.documentElement.scrollHeight <=
                document.documentElement.clientHeight,
          );
          if (iframe === null || canvas === null || stage === null)
            return false;
          const inside = (box: {
            x: number;
            y: number;
            width: number;
            height: number;
          }) =>
            box.x >= iframe.x - 1 &&
            box.y >= iframe.y - 1 &&
            box.x + box.width <= iframe.x + iframe.width + 1 &&
            box.y + box.height <= iframe.y + iframe.height + 1;
          return (
            fits &&
            inside(canvas) &&
            canvas.width > 200 &&
            canvas.height > 100 &&
            Math.abs(
              canvas.width -
                Math.min(1400, stage.width - 16, ((stage.height - 16) * 5) / 3),
            ) < 2 &&
            Math.abs(canvas.width / canvas.height - 5 / 3) < 0.01 &&
            buttons.length === 7 &&
            audioToggle !== null &&
            audioToggle.width >= 44 &&
            audioToggle.height >= 44 &&
            inside(audioToggle) &&
            buttons.every(
              (box) =>
                box !== null &&
                box.width >= 44 &&
                box.height >= 44 &&
                inside(box),
            )
          );
        },
        {
          message: `Badminton court and touch controls fit ${viewport.width}×${viewport.height}`,
        },
      )
      .toBe(true);
    if (
      viewport.width === 1440 ||
      viewport.width === 1024 ||
      viewport.width === 768 ||
      viewport.width === 390 ||
      viewport.width === 844
    ) {
      await page.screenshot({
        path: info.outputPath(
          `badminton-${viewport.width}x${viewport.height}.png`,
        ),
      });
    }
  }
}

test("two accounts play badminton with keyboard and multitouch, reconnect, finish, rematch and resign", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const contextB = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const browserErrors: string[] = [];
  pageA.on("pageerror", (error) => browserErrors.push(error.message));
  pageB.on("pageerror", (error) => browserErrors.push(error.message));
  const database = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "badminton-e2e-authority",
    maxConnections: 2,
  });
  const roomStore = new PostgresRealtimeRoomStore(database.database);
  const replayStore = new PostgresRealtimeReplayStore(database.database);
  try {
    await Promise.all([
      registerE2eAccount(pageA.request, harness.webUrl, "badminton_account_a"),
      registerE2eAccount(pageB.request, harness.webUrl, "badminton_account_b"),
    ]);
    await pageA.goto(`${harness.webUrl}/games/badminton`);
    await pageA.getByTestId("create-room").click();
    await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
    await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
      "src",
      "/game-surfaces/badminton/1.2.2/setup/index.html",
    );
    const inviteUrl = await pageA
      .getByTestId("invite-link")
      .getAttribute("href");
    if (inviteUrl === null)
      throw new Error("Badminton invite link is missing.");
    const roomCode = new URL(inviteUrl).pathname.split("/").at(-1) ?? "";
    await pageB.goto(inviteUrl);
    await expect(pageB.getByTestId("connection-state")).toHaveText("已连接");
    await expect(surface(pageB).locator('[data-score="11"]')).toBeDisabled();
    await pageA.getByTestId("toggle-round-ready").click();
    await expect(pageA.getByTestId("toggle-round-ready")).toHaveText(
      "取消准备",
    );
    await surface(pageA).locator('[data-score="11"]').click();
    await expect(surface(pageB).locator('[data-score="11"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(pageA.getByTestId("toggle-round-ready")).toHaveText(
      "准备开始",
    );
    await surface(pageA).locator('[data-score="7"]').click();
    await expect(surface(pageB).locator('[data-score="7"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await pageA.screenshot({ path: info.outputPath("badminton-setup.png") });
    await pageA.getByTestId("toggle-round-ready").click();
    await pageB.getByTestId("toggle-round-ready").click();
    for (const page of [pageA, pageB]) {
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/badminton/1.2.2/play/index.html",
      );
      await expectCourt(page);
    }
    const slotA = (
      await pageA.getByTestId("player-slot").textContent()
    )?.trim();
    const slotB = (
      await pageB.getByTestId("player-slot").textContent()
    )?.trim();
    expect(slotA).toBeTruthy();
    expect(slotB).toBeTruthy();
    expect(slotA).not.toBe(slotB);
    await expect(surface(pageA).locator("#side-label")).toHaveText(
      "你在左侧 · 蓝方",
    );
    await expect(surface(pageB).locator("#side-label")).toHaveText(
      "你在右侧 · 橙方",
    );
    await expect(surface(pageA).locator("html")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    await expectLayouts(pageA, info);
    const sound = surface(pageA).getByRole("button", {
      name: "音效",
      exact: true,
    });
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.press("Enter");
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    const initialRoom = await roomStore.getByRoomCode(roomCode);
    const replayId = initialRoom?.currentRound?.replayId;
    if (replayId === undefined)
      throw new Error("Active badminton round was not persisted.");
    await advance(pageA, 240);
    expect(await score(pageA)).toEqual([0, 0]);
    await expect(surface(pageA).locator("#root")).toHaveAttribute(
      "data-phase",
      "SERVE",
    );

    await surface(pageA).locator("#badminton-canvas").click();
    await pageA.keyboard.down("KeyD");
    await pageA.keyboard.down("KeyW");
    await pageA.keyboard.down("KeyK");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        const replay = await replayStore.get(replayId);
        return replay?.events
          .filter((event) => event.actorSlotId === slotA)
          .map((event) => event.input);
      })
      .toContainEqual({
        type: "CONTROL",
        move: 1,
        jump: true,
        serve: false,
        shot: "SMASH",
      });
    await pageA.keyboard.up("KeyD");
    await pageA.keyboard.up("KeyW");
    await pageA.keyboard.up("KeyK");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        const replay = await replayStore.get(replayId);
        return replay?.events
          .filter((event) => event.actorSlotId === slotA)
          .at(-1)?.input;
      })
      .toEqual({
        type: "CONTROL",
        move: 0,
        jump: false,
        serve: false,
        shot: "NONE",
      });

    // Real Chromium touch input exercises pointer capture and simultaneous
    // contacts; dispatching synthetic pointerdown alone would miss that path.
    const touch = await contextB.newCDPSession(pageB);
    const touchPoints = await Promise.all(
      ["left", "jump", "drop"].map(async (control, index) => {
        const box = await surface(pageB)
          .locator(`[data-control="${control}"]`)
          .boundingBox();
        if (box === null) throw new Error(`Missing touch control ${control}.`);
        return {
          id: index + 1,
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
      touchPoints,
    });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        const replay = await replayStore.get(replayId);
        return replay?.events
          .filter((event) => event.actorSlotId === slotB)
          .map((event) => event.input);
      })
      .toContainEqual({
        type: "CONTROL",
        move: -1,
        jump: true,
        serve: false,
        shot: "DROP",
      });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        const replay = await replayStore.get(replayId);
        return replay?.events
          .filter((event) => event.actorSlotId === slotB)
          .at(-1)?.input;
      })
      .toEqual({
        type: "CONTROL",
        move: 0,
        jump: false,
        serve: false,
        shot: "NONE",
      });
    await expect(
      surface(pageB).locator('[data-control][aria-pressed="true"]'),
    ).toHaveCount(0);
    await touch.detach();

    // Leaving the game frame while holding a key must also release movement.
    await surface(pageA).locator("#badminton-canvas").click();
    await pageA.keyboard.down("KeyA");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        const replay = await replayStore.get(replayId);
        return replay?.events
          .filter((event) => event.actorSlotId === slotA)
          .at(-1)?.input;
      })
      .toEqual({
        type: "CONTROL",
        move: -1,
        jump: false,
        serve: false,
        shot: "NONE",
      });
    await openGameHud(pageA);
    await pageA.keyboard.up("KeyA");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        const replay = await replayStore.get(replayId);
        return replay?.events
          .filter((event) => event.actorSlotId === slotA)
          .at(-1)?.input;
      })
      .toEqual({
        type: "CONTROL",
        move: 0,
        jump: false,
        serve: false,
        shot: "NONE",
      });
    await closeGameHud(pageA);

    await surface(pageA).locator("#badminton-canvas").click();
    await pageA.keyboard.down("KeyD");
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return (await replayStore.get(replayId))?.events
          .filter((event) => event.actorSlotId === slotA)
          .at(-1)?.input;
      })
      .toEqual({
        type: "CONTROL",
        move: 1,
        jump: false,
        serve: false,
        shot: "NONE",
      });
    await advance(pageA, 40);
    await expect.poll(() => serviceLinePixel(pageA)).toEqual([70, 127, 170]);
    await advance(pageA, 3);
    await expect.poll(() => serviceLinePixel(pageA)).toEqual([70, 127, 170]);
    await pageA.keyboard.up("KeyD");
    await advance(pageA, 1);
    await pageA.screenshot({
      path: info.outputPath("badminton-service-line.png"),
    });
    await pageA.keyboard.down("KeyW");
    await advance(pageA, 3);
    await serve(pageA);
    await pageA.keyboard.up("KeyW");
    await expect
      .poll(() => serviceLinePixel(pageA))
      .not.toEqual([70, 127, 170]);
    await pageA.screenshot({
      path: info.outputPath("badminton-airborne-serve.png"),
    });
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await sound.focus();
    await pageA.keyboard.press("Space");
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await pageA.keyboard.press("Space");
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.click();
    await advance(pageA, 100);
    const firstScore = await score(pageA);
    expect(firstScore[0] + firstScore[1]).toBeGreaterThan(0);
    await expect.poll(() => score(pageB)).toEqual(firstScore);

    await pageA.close();
    const resumed = await contextA.newPage();
    resumed.on("pageerror", (error) => browserErrors.push(error.message));
    await resumed.goto(inviteUrl);
    await expect(resumed.getByTestId("connection-state")).toHaveText("已连接");
    await expect(resumed.getByTestId("player-slot")).toHaveText(slotA ?? "");
    await expect(resumed.getByTestId("server-tick")).not.toHaveText("0");
    await expect.poll(() => score(resumed)).toEqual(firstScore);
    await expectCourt(resumed);

    for (let batch = 0; batch < 12; batch++) {
      if (
        (await resumed
          .getByTestId("match-status")
          .getAttribute("data-status")) === "completed"
      )
        break;
      const phase = await surface(resumed)
        .locator("#root")
        .getAttribute("data-phase");
      if (phase === "SERVE") await serve(resumed);
      await advance(resumed, 176);
    }
    await expect(resumed.getByTestId("match-status")).toHaveText("对局已完成");
    await expect(pageB.getByTestId("match-status")).toHaveText("对局已完成");
    await expect(surface(resumed).getByTestId("badminton-outcome")).toHaveText(
      "SCORE",
    );
    const finalScore = await score(resumed);
    expect(Math.max(...finalScore)).toBe(7);
    await expect.poll(() => score(pageB)).toEqual(finalScore);
    const completedReplay = await replayStore.get(replayId);
    expect(completedReplay?.recordedRngCursor).toBe(0);
    expect(
      verifyRealtimeReplay(completedReplay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    await resumed.screenshot({
      path: info.outputPath("badminton-completed.png"),
    });

    const historyResponse = await resumed.request.get(
      `${harness.webUrl}/api/matches`,
    );
    expect(historyResponse.status()).toBe(200);
    const history = (await historyResponse.json()) as {
      matches: { matchId: string; gameId: string; replayAvailable: boolean }[];
    };
    const match = history.matches.find((item) => item.gameId === "badminton");
    expect(match?.replayAvailable).toBe(false);
    if (match === undefined)
      throw new Error("Badminton match is missing from private history.");
    const playback = await resumed.request.get(
      `${harness.webUrl}/api/matches/${encodeURIComponent(match.matchId)}/replay`,
    );
    expect(playback.status()).toBe(409);
    expect(await playback.json()).toEqual({
      code: "PLAYER_PLAYBACK_NOT_SUPPORTED",
    });

    await resumed.getByTestId("rematch-game").click();
    await expect(resumed.getByTestId("match-status")).toHaveText("对局已完成");
    await pageB.getByTestId("rematch-game").click();
    for (const page of [resumed, pageB]) {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect.poll(() => score(page)).toEqual([0, 0]);
    }
    const nextRoom = await roomStore.getByRoomCode(roomCode);
    expect(nextRoom?.previousFinalizedSetup?.config).toEqual({
      targetScore: 7,
    });
    expect(nextRoom?.currentRound?.playerOrder).toEqual([slotA, slotB]);
    const nextReplayId = nextRoom?.currentRound?.replayId;
    expect(nextReplayId).not.toBe(replayId);
    if (nextReplayId === undefined)
      throw new Error("Rematch replay is missing.");

    await openGameHud(pageB);
    // Rematch resets held controls. With the manual clock, process that input
    // before requesting a Host command, which rejects overlapping intents.
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return Number(
          await pageB.getByTestId("acknowledged-input-sequence").textContent(),
        );
      })
      .toBeGreaterThan(0);
    pageB.once("dialog", (dialog) => {
      void dialog.dismiss();
    });
    await pageB.getByTestId("resign-game").click();
    await expect(pageB.getByTestId("match-status")).toHaveText("对局进行中");
    expect(
      (await replayStore.get(nextReplayId))?.events.some((event) =>
        isResign(event.input),
      ),
    ).toBe(false);
    pageB.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await pageB.getByTestId("resign-game").click();
    await expect
      .poll(async () => {
        harness.advanceRealtimeTicks(1);
        return pageB.getByTestId("match-status").textContent();
      })
      .toBe("对局已完成");
    await expect(surface(resumed).getByTestId("badminton-outcome")).toHaveText(
      "RESIGNATION",
    );
    const resignationReplay = await replayStore.get(nextReplayId);
    expect(resignationReplay?.recordedOutcome).toMatchObject({
      reason: "RESIGNATION",
      winnerSlotId: slotA,
      resignedSlotId: slotB,
    });
    expect(
      resignationReplay?.events.filter((event) => isResign(event.input)),
    ).toHaveLength(1);
    expect(
      verifyRealtimeReplay(resignationReplay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    expect(browserErrors).toEqual([]);
  } finally {
    await database.close();
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
