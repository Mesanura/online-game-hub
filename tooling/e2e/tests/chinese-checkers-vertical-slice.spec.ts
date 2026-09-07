import { expect, test } from "@playwright/test";
import type { FrameLocator, Page } from "@playwright/test";

import {
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import { verifyReplay } from "@online-game-hub/game-server-runtime";

import { registerE2eAccount } from "../src/account.js";
import { closeGameHud, openGameHud } from "../src/game-hud.js";
import { startE2eHarness } from "../src/harness.js";
import type { E2eHarness } from "../src/harness.js";

let harness: E2eHarness;

function chineseCheckersSurface(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="game-surface-iframe"]');
}

async function expectSetupIntentSettled(surface: FrameLocator): Promise<void> {
  await expect(surface.locator(".surface-meta")).not.toContainText(
    "正在确认操作…",
  );
}

async function expectRegularBoard(
  surface: FrameLocator,
  touch = false,
): Promise<void> {
  const geometry = await surface
    .locator(".chinese-checkers-board")
    .evaluate((board) => {
      const bounds = board.getBoundingClientRect();
      const rows = Array.from(board.querySelectorAll('[role="row"]'), (row) =>
        Array.from(
          row.querySelectorAll<HTMLButtonElement>("[data-cell-index]"),
          (cell) => {
            const rectangle = cell.getBoundingClientRect();
            return {
              index: Number(cell.dataset.cellIndex),
              x: rectangle.x + rectangle.width / 2,
              y: rectangle.y + rectangle.height / 2,
              width: rectangle.width,
              height: rectangle.height,
            };
          },
        ),
      );
      const cells = new Map(rows.flat().map((cell) => [cell.index, cell]));
      const svg = board.querySelector("svg");
      const matrix = svg?.getScreenCTM();
      const shell = board.parentElement;
      if (svg === null || matrix == null || shell === null) {
        throw new Error("Missing board drawing or scrolling container.");
      }
      const links = Array.from(svg.querySelectorAll("line"), (line) => {
        const start = cells.get(Number(line.dataset.from));
        const end = cells.get(Number(line.dataset.to));
        if (start === undefined || end === undefined) {
          throw new Error(
            "A board connection does not reference a rendered cell.",
          );
        }
        const drawnStart = new DOMPoint(
          line.x1.baseVal.value,
          line.y1.baseVal.value,
        ).matrixTransform(matrix);
        const drawnEnd = new DOMPoint(
          line.x2.baseVal.value,
          line.y2.baseVal.value,
        ).matrixTransform(matrix);
        return {
          length: Math.hypot(end.x - start.x, end.y - start.y),
          startOffset: Math.hypot(
            start.x - drawnStart.x,
            start.y - drawnStart.y,
          ),
          endOffset: Math.hypot(end.x - drawnEnd.x, end.y - drawnEnd.y),
        };
      });
      return {
        rows,
        links,
        bounds: {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        },
        regions: svg.querySelectorAll("polygon").length,
        overflowX: shell.scrollWidth - shell.clientWidth,
        overflowY: shell.scrollHeight - shell.clientHeight,
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
      };
    });
  const rowLengths = [1, 2, 3, 10, 9, 8, 7, 8, 9, 10, 3, 2, 1];
  const leadingSpaces = [9, 8, 7, 0, 1, 2, 3, 2, 1, 0, 7, 8, 9];
  expect(geometry.rows.map((row) => row.length)).toEqual(rowLengths);
  const leftmost = geometry.rows[3]?.[0];
  const neighbor = geometry.rows[3]?.[1];
  const topmost = geometry.rows[0]?.[0];
  if (
    leftmost === undefined ||
    neighbor === undefined ||
    topmost === undefined
  ) {
    throw new Error("The ASCII reference rows are missing.");
  }
  const spacing = neighbor.x - leftmost.x;
  for (const [rowIndex, row] of geometry.rows.entries()) {
    for (const [columnIndex, cell] of row.entries()) {
      const expectedX =
        leftmost.x +
        ((leadingSpaces[rowIndex] ?? 0) / 2 + columnIndex) * spacing;
      const expectedY = topmost.y + (rowIndex * Math.sqrt(3) * spacing) / 2;
      expect(Math.abs(cell.x - expectedX)).toBeLessThan(0.2);
      expect(Math.abs(cell.y - expectedY)).toBeLessThan(0.2);
      expect(Math.abs(cell.width - cell.height)).toBeLessThan(0.1);
      expect(cell.x - cell.width / 2).toBeGreaterThanOrEqual(
        geometry.bounds.left,
      );
      expect(cell.x + cell.width / 2).toBeLessThanOrEqual(
        geometry.bounds.right,
      );
      expect(cell.y - cell.height / 2).toBeGreaterThanOrEqual(
        geometry.bounds.top,
      );
      expect(cell.y + cell.height / 2).toBeLessThanOrEqual(
        geometry.bounds.bottom,
      );
      if (touch) expect(cell.width).toBeGreaterThanOrEqual(43.9);
    }
  }
  expect(geometry.regions).toBe(7);
  expect(geometry.links).toHaveLength(180);
  for (const link of geometry.links) {
    expect(Math.abs(link.length - spacing)).toBeLessThan(0.2);
    expect(link.startOffset).toBeLessThan(0.2);
    expect(link.endOffset).toBeLessThan(0.2);
  }
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  if (!touch) {
    expect(geometry.overflowX).toBeLessThanOrEqual(1);
    expect(geometry.overflowY).toBeLessThanOrEqual(1);
  }
}

test.beforeAll(async () => {
  harness = await startE2eHarness();
});

test.afterAll(async () => {
  await harness?.stop();
});

function capturePageErrors(page: Page, errors: string[]): void {
  page.on("pageerror", (error) => errors.push(error.message));
}

async function expectRevision(
  pages: readonly Page[],
  revision: number,
): Promise<void> {
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("revision")).toHaveText(String(revision)),
    ),
  );
}

function acceptResignation(page: Page): Promise<string> {
  return new Promise((resolve, reject) => {
    page.once("dialog", (dialog) => {
      if (dialog.type() !== "confirm") {
        reject(new Error(`Unexpected ${dialog.type()} dialog.`));
        return;
      }
      const message = dialog.message();
      void dialog.accept().then(() => resolve(message), reject);
    });
    void page.getByTestId("resign-game").click();
  });
}

async function readHistory(
  page: Page,
): Promise<readonly Record<string, unknown>[]> {
  const response = await page.request.get(`${harness.webUrl}/api/matches`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  const body = (await response.json()) as {
    readonly matches?: readonly Record<string, unknown>[];
  };
  return body.matches ?? [];
}

test("three accounts configure camps in the independent Surface, rematch with complete settings, and replay both rankings", async ({
  browser,
}) => {
  const contextA = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 720 },
  });
  const contextB = await browser.newContext({
    hasTouch: true,
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  const contextC = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const pages = [pageA, pageB, pageC] as const;
  await Promise.all([
    registerE2eAccount(pageA.request, harness.webUrl, "cc_account_a"),
    registerE2eAccount(pageB.request, harness.webUrl, "cc_account_b"),
    registerE2eAccount(pageC.request, harness.webUrl, "cc_account_c"),
  ]);
  const browserErrors: string[] = [];
  for (const page of pages) capturePageErrors(page, browserErrors);

  await pageA.goto(`${harness.webUrl}/games`);
  const gameCard = pageA.getByRole("article").filter({ hasText: "中国跳棋" });
  await expect(gameCard).toContainText("2–6");
  await gameCard.getByRole("link", { name: "创建或加入房间" }).click();
  await pageA.getByTestId("create-room").click();
  await expect(pageA.getByTestId("connection-state")).toHaveText("已连接");
  await expect(pageA.getByTestId("game-stage")).toHaveCount(0);
  await expect(pageA.getByTestId("match-status")).toHaveCount(0);
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/chinese-checkers/1.1.1/setup/index.html",
  );

  const setupA = chineseCheckersSurface(pageA);
  await expect(
    setupA.getByRole("group", { name: "首位规则" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(setupA.locator('[data-starter="CAMP"]')).toContainText(
    "指定首位",
  );
  await expect(setupA.locator('[data-starter="RANDOM"]')).toContainText(
    "随机首位",
  );
  await expect(
    setupA.getByRole("button", { name: /房主首位|其他玩家首位/u }),
  ).toHaveCount(0);
  await setupA.locator("[data-player-count]").selectOption("3");
  await expect(setupA.getByTestId("setup-status")).toContainText(
    "等待 3 位玩家",
  );
  await expectSetupIntentSettled(setupA);
  await setupA.locator('[data-camp-option="N"]').click();
  await expectSetupIntentSettled(setupA);
  await setupA.locator('[data-starter="CAMP"]').click();
  await expectSetupIntentSettled(setupA);
  await expect(setupA.getByLabel("首位营地").locator("option")).toHaveText([
    "北营地（1号）",
    "东北营地（2号）",
    "东南营地（3号）",
    "南营地（4号）",
    "西南营地（5号）",
    "西北营地（6号）",
  ]);
  await expect(setupA.locator("[data-camp-option] strong")).toHaveText([
    "北营地（1号）",
    "东北营地（2号）",
    "东南营地（3号）",
    "南营地（4号）",
    "西南营地（5号）",
    "西北营地（6号）",
  ]);
  await setupA.getByLabel("首位营地").selectOption("NE");
  await expectSetupIntentSettled(setupA);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 720 },
  ]) {
    await pageA.setViewportSize(viewport);
    await setupA.getByLabel("首位营地").scrollIntoViewIfNeeded();
    await expect(setupA.getByLabel("首位营地")).toBeInViewport();
    const layout = await setupA.locator(".setup-card").evaluate((card) => ({
      overflow: card.scrollWidth - card.clientWidth,
      selectHeight: card
        .querySelector("[data-starter-camp]")
        ?.getBoundingClientRect().height,
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.selectHeight).toBeGreaterThanOrEqual(44);
  }

  const inviteUrl = await pageA.getByTestId("invite-link").getAttribute("href");
  if (inviteUrl === null) {
    throw new Error("Chinese Checkers did not expose an invitation URL.");
  }
  const invitation = new URL(inviteUrl);
  expect(invitation.pathname).toMatch(
    /^\/games\/chinese-checkers\/rooms\/[A-HJ-NP-Z2-9]{8}$/u,
  );
  const roomCode = invitation.pathname.split("/").at(-1);
  if (roomCode === undefined || roomCode.length === 0) {
    throw new Error("Chinese Checkers invitation omitted its room code.");
  }

  await Promise.all([pageB.goto(inviteUrl), pageC.goto(inviteUrl)]);
  await Promise.all(
    [pageB, pageC].map((page) =>
      expect(page.getByTestId("connection-state")).toHaveText("已连接"),
    ),
  );
  const setupB = chineseCheckersSurface(pageB);
  const setupC = chineseCheckersSurface(pageC);
  await expect(setupB.getByLabel("首位营地")).toHaveValue("NE");
  await expect(setupB.getByLabel("首位营地")).toBeDisabled();
  await expect(setupB.locator('[data-starter="CAMP"]')).toBeDisabled();
  await expect(setupB.locator('[data-starter="RANDOM"]')).toBeDisabled();
  await setupB.locator('[data-camp-option="S"]').click();
  await expectSetupIntentSettled(setupB);
  await setupC.locator('[data-camp-option="NE"]').click();
  await expectSetupIntentSettled(setupC);
  await expect(setupA.getByTestId("setup-status")).toHaveText(
    "设置完成，所有参与者可以分别准备",
  );
  await setupA.getByLabel("首位营地").selectOption("NW");
  await expectSetupIntentSettled(setupA);
  await expect(setupA.getByTestId("setup-status")).toHaveText(
    "等待玩家选择西北营地（6号），或请房主重新指定首位",
  );
  await expect(pageA.getByTestId("toggle-round-ready")).toBeDisabled();
  await setupA.getByLabel("首位营地").selectOption("NE");
  await expectSetupIntentSettled(setupA);
  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/3 人已准备",
  );
  await setupA.getByLabel("首位营地").selectOption("S");
  await expectSetupIntentSettled(setupA);
  await expect
    .poll(async () => {
      const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
      return room?.nextRoundSetup?.readySlotIds;
    })
    .toEqual([]);
  await setupA.locator('[data-starter="RANDOM"]').click();
  await expectSetupIntentSettled(setupA);
  await expect(setupA.getByLabel("首位营地")).toHaveCount(0);
  await expect(setupA.locator('[data-starter="RANDOM"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => {
      const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
      return room?.nextRoundSetup?.setupState;
    })
    .toMatchObject({ starter: "RANDOM", starterCamp: null });
  await setupA.locator('[data-starter="CAMP"]').click();
  await expectSetupIntentSettled(setupA);
  await setupA.getByLabel("首位营地").selectOption("NE");
  await expectSetupIntentSettled(setupA);

  const slotA = (await pageA.getByTestId("player-slot").textContent())?.trim();
  const slotB = (await pageB.getByTestId("player-slot").textContent())?.trim();
  const slotC = (await pageC.getByTestId("player-slot").textContent())?.trim();
  if (slotA === undefined || slotB === undefined || slotC === undefined) {
    throw new Error("A connected Chinese Checkers player is missing a slot.");
  }
  expect(new Set([slotA, slotB, slotC]).size).toBe(3);
  const setupAssignmentsByStableSlot = [
    { slotId: slotA, camp: "N" },
    { slotId: slotB, camp: "S" },
    { slotId: slotC, camp: "NE" },
  ].sort((left, right) => left.slotId.localeCompare(right.slotId));

  const waitingRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  expect(waitingRoom).toMatchObject({
    gameId: "chinese-checkers",
    gameVersion: "1.1.0",
    setupProtocol: 6,
    nextRoundSetup: {
      setupState: {
        targetPlayerCount: 3,
        starter: "CAMP",
        fixedStarterSlotId: null,
        starterCamp: "NE",
        assignments: setupAssignmentsByStableSlot,
      },
      readySlotIds: [],
      finalizedSetup: null,
    },
  });

  await pageA.getByTestId("toggle-round-ready").click();
  await expect(pageB.getByTestId("round-setup-status")).toHaveText(
    "1/3 人已准备",
  );
  await pageB.getByTestId("toggle-round-ready").click();
  await expect(pageC.getByTestId("round-setup-status")).toHaveText(
    "2/3 人已准备",
  );
  await pageC.getByTestId("toggle-round-ready").click();

  for (const page of pages) {
    await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
    await expect(page.getByTestId("room-code")).toHaveText(roomCode);
    await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
      "src",
      "/game-surfaces/chinese-checkers/1.1.1/play/index.html",
    );
    const surface = chineseCheckersSurface(page);
    await expect(
      surface.getByRole("grid", { name: "中国跳棋六芒星棋盘" }),
    ).toBeVisible();
    await expect(surface.getByTestId("board-connections")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(
      surface.getByTestId("board-connections").locator("line"),
    ).toHaveCount(180);
    await expect(surface.locator("[data-cell-index]")).toHaveCount(73);
    await expect(surface.locator('[data-occupied="true"]')).toHaveCount(18);
    await expect(
      surface.locator('[data-cell-index][data-camp="CENTER"]'),
    ).toHaveCount(37);
    for (const camp of ["N", "NE", "SE", "S", "SW", "NW"] as const) {
      await expect(
        surface.locator(`[data-cell-index][data-camp="${camp}"]`),
      ).toHaveCount(6);
    }
    await expectRegularBoard(surface, page === pageB);
  }
  await expect(
    chineseCheckersSurface(pageA).getByTestId("player-camp"),
  ).toContainText("北营地（1号）");
  await expect(
    chineseCheckersSurface(pageB).getByTestId("player-camp"),
  ).toContainText("南营地（4号）");
  await expect(
    chineseCheckersSurface(pageC).getByTestId("player-camp"),
  ).toContainText("东北营地（2号）");
  await expect(
    chineseCheckersSurface(pageC).getByTestId("turn-status"),
  ).toContainText("轮到你行动");
  await expect(
    chineseCheckersSurface(pageA).locator("[data-cell-index]:not(:disabled)"),
  ).toHaveCount(0);
  await expect(
    chineseCheckersSurface(pageB).locator("[data-cell-index]:not(:disabled)"),
  ).toHaveCount(0);
  for (const viewport of [
    { width: 2560, height: 1440 },
    { width: 1707, height: 960 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await pageA.setViewportSize(viewport);
    await expectRegularBoard(chineseCheckersSurface(pageA));
  }
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await pageB.setViewportSize(viewport);
    await expectRegularBoard(chineseCheckersSurface(pageB), true);
    for (const cell of [72, 6, 15, 0]) {
      const targetCell = chineseCheckersSurface(pageB).locator(
        '[data-cell-index="' + cell + '"]',
      );
      await targetCell.scrollIntoViewIfNeeded();
      await expect(targetCell).toBeInViewport();
    }
  }
  const source = chineseCheckersSurface(pageC)
    .locator('[data-legal-source="true"]')
    .first();
  await expect(source).toBeEnabled();
  await source.click();
  const target = chineseCheckersSurface(pageC)
    .locator(".is-legal-target:not(:disabled)")
    .first();
  await expect(target).toBeVisible();
  const targetCell = await target.getAttribute("data-cell-index");
  if (targetCell === null)
    throw new Error("Move target omitted its cell index.");
  await target.click();
  await expectRevision(pages, 1);
  const movedPiece = chineseCheckersSurface(pageA).locator(
    `[data-cell-index="${targetCell}"]`,
  );
  await expect(movedPiece).toHaveAttribute("data-piece-camp", "NE");
  await expect(movedPiece.locator(".chinese-checkers-piece")).toHaveCSS(
    "background-color",
    "rgb(224, 170, 50)",
  );

  await Promise.all([pageB, pageC].map((page) => openGameHud(page)));
  expect(await acceptResignation(pageB)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 2);
  expect(await acceptResignation(pageC)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 3);
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  const firstRanking = chineseCheckersSurface(pageA)
    .getByRole("list", { name: "最终排名" })
    .getByRole("listitem")
    .first();
  await expect(firstRanking).toContainText("第 1 名");
  await expect(firstRanking).toContainText(slotA);

  const roundOneRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  const roundOne = roundOneRoom?.currentRound;
  if (roundOne === null || roundOne === undefined) {
    throw new Error("The first Chinese Checkers round was not archived.");
  }
  expect(roundOneRoom).toMatchObject({
    setupProtocol: 6,
    currentRound: { roundNumber: 1, revision: 3, status: "completed" },
    nextRoundSetup: {
      setupState: {
        targetPlayerCount: 3,
        starter: "FIXED",
        fixedStarterSlotId: slotC,
        starterCamp: null,
        assignments: setupAssignmentsByStableSlot,
      },
      setupRevision: 0,
      readySlotIds: [],
      finalizedSetup: null,
    },
  });
  const roundOneReplayId = roundOne.replayId;

  await expect(pageA.getByTestId("game-result-hud")).toContainText(
    "你获得第 1 名",
  );
  await Promise.all([pageB, pageC].map((page) => closeGameHud(page)));
  await pageA.getByTestId("rematch-game").click();
  await expect(pageA.getByTestId("rematch-game")).toHaveText(
    "等待其余 2 名玩家确认",
  );
  await expect
    .poll(async () => {
      const room = await harness.gameServer.roomStore.getByRoomCode(roomCode);
      return room?.nextRoundSetup?.readySlotIds;
    })
    .toEqual([slotA]);
  await pageB.getByTestId("rematch-game").click();
  await expect(pageA.getByTestId("rematch-game")).toHaveText(
    "等待其余 1 名玩家确认",
  );
  await pageC.getByTestId("rematch-game").click();

  await Promise.all(
    pages.map(async (page) => {
      await expect(page.getByTestId("round-number")).toHaveText("第 2 局");
      await expect(page.getByTestId("match-status")).toHaveText("对局进行中");
      await expect(page.getByTestId("revision")).toHaveText("0");
      await expect(page.getByTestId("game-surface-iframe")).toHaveAttribute(
        "src",
        "/game-surfaces/chinese-checkers/1.1.1/play/index.html",
      );
      await expect(
        chineseCheckersSurface(page).locator('[data-occupied="true"]'),
      ).toHaveCount(18);
    }),
  );
  const roundTwoActiveRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  expect(roundTwoActiveRoom?.previousFinalizedSetup).toEqual({
    config: null,
    participantSlotIds: setupAssignmentsByStableSlot.map(
      (assignment) => assignment.slotId,
    ),
    playerOrder: [slotC, slotA, slotB],
    assignments: [
      { slotId: slotC, assignment: "NE" },
      { slotId: slotA, assignment: "N" },
      { slotId: slotB, assignment: "S" },
    ],
  });

  await Promise.all([pageB, pageC].map((page) => openGameHud(page)));
  expect(await acceptResignation(pageB)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 1);
  expect(await acceptResignation(pageC)).toContain("排在未投降玩家之后");
  await expectRevision(pages, 2);
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("match-status")).toHaveText("对局已完成"),
    ),
  );
  const roundTwoRoom =
    await harness.gameServer.roomStore.getByRoomCode(roomCode);
  const roundTwo = roundTwoRoom?.currentRound;
  if (roundTwo === null || roundTwo === undefined) {
    throw new Error("The second Chinese Checkers round was not archived.");
  }
  expect(roundTwo).toMatchObject({
    roundNumber: 2,
    revision: 2,
    status: "completed",
  });
  expect(roundTwo.replayId).not.toBe(roundOneReplayId);

  const rebuiltClient = createPostgresDatabaseClient({
    url: harness.databaseUrl,
    applicationName: "chinese-checkers-e2e-replays",
    maxConnections: 2,
  });
  try {
    const replayStore = new PostgresReplayStore(rebuiltClient.database);
    const [roundOneReplay, roundTwoReplay] = await Promise.all([
      replayStore.get(roundOneReplayId),
      replayStore.get(roundTwo.replayId),
    ]);
    const expectedPlayers = [
      { slotId: slotC, assignment: "NE" },
      { slotId: slotA, assignment: "N" },
      { slotId: slotB, assignment: "S" },
    ];
    expect(roundOneReplay?.header.players).toEqual(expectedPlayers);
    expect(roundTwoReplay?.header.players).toEqual(expectedPlayers);
    expect(roundOneReplay?.actions).toHaveLength(3);
    expect(roundTwoReplay?.actions).toHaveLength(2);
    expect(roundOneReplay?.header.rng.seed).not.toBe(
      roundTwoReplay?.header.rng.seed,
    );
    expect(verifyReplay(roundOneReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "RANKING" },
    });
    expect(verifyReplay(roundTwoReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "RANKING" },
    });
  } finally {
    await rebuiltClient.close();
  }

  const [historyA, historyB, historyC] = await Promise.all([
    readHistory(pageA),
    readHistory(pageB),
    readHistory(pageC),
  ]);
  for (const history of [historyA, historyB, historyC]) {
    expect(history).toHaveLength(2);
    expect(history.map((match) => match.roundNumber).sort()).toEqual([1, 2]);
    expect(
      history.every(
        (match) =>
          match.gameId === "chinese-checkers" &&
          match.gameVersion === "1.1.0" &&
          match.replayAvailable === true,
      ),
    ).toBe(true);
  }
  expect(new Set(historyA.map((match) => match.matchId))).toEqual(
    new Set(historyB.map((match) => match.matchId)),
  );
  expect(new Set(historyA.map((match) => match.matchId))).toEqual(
    new Set(historyC.map((match) => match.matchId)),
  );

  await openGameHud(pageA);
  await pageA.getByTestId("close-room").click();
  await Promise.all(
    pages.map((page) =>
      expect(page.getByTestId("room-notice")).toHaveText("房主已关闭房间。"),
    ),
  );
  const replayMatchId = String(
    historyA.find((match) => match.roundNumber === 1)?.matchId,
  );
  await pageA.goto(
    `${harness.webUrl}/account/matches/${encodeURIComponent(replayMatchId)}/replay`,
  );
  await expect(pageA.getByTestId("replay-page")).toBeVisible();
  await expect(pageA.getByTestId("game-surface-iframe")).toHaveAttribute(
    "src",
    "/game-surfaces/chinese-checkers/1.1.1/replay/index.html",
  );
  const replaySurface = chineseCheckersSurface(pageA);
  await expect(
    replaySurface.getByTestId("board-connections").locator("line"),
  ).toHaveCount(180);
  await expectRegularBoard(replaySurface);
  await expect(replaySurface.locator("[data-cell-index]")).toHaveCount(73);
  await expect(pageA.getByTestId("replay-frame-count")).toHaveText("1 / 4");
  await expect(replaySurface.locator('[data-occupied="true"]')).toHaveCount(18);
  await expect(
    replaySurface.locator("[data-cell-index]:not(:disabled)"),
  ).toHaveCount(0);
  await pageA.getByTestId("replay-last").click();
  await expect(pageA.getByTestId("replay-frame-count")).toHaveText("4 / 4");
  await expect(
    replaySurface.getByRole("list", { name: "最终排名" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(replaySurface.getByTestId("turn-status")).toContainText(
    "第一名：北营地（1号）",
  );
  expect(browserErrors).toEqual([]);
  await Promise.all([contextA.close(), contextB.close(), contextC.close()]);
});
