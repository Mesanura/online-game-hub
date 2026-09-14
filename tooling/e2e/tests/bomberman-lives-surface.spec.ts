import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlaySurface } from "../src/play-surface.js";

interface View {
  phase: string;
  phaseTicks: number;
  arena: { cols: number; rows: number; cellSize: number; tiles: string[] };
  players: {
    slotId: string;
    index: number;
    x: number;
    y: number;
    alive: boolean;
    lives: number;
    invulnerableTicks: number;
    resigned: boolean;
    capacity: number;
    activeBombs: number;
    range: number;
  }[];
  flames: { cell: number; shape: string; remainingTicks: number }[];
  bombs: unknown[];
  pickups: unknown[];
  events: { id: number; kind: string; x: number; y: number }[];
  outcome: unknown;
}
async function fixture(version = "1.1.0"): Promise<View> {
  return JSON.parse(
    await readFile(
      new URL(
        "../../../game-surfaces/bomberman/tests/fixtures/play-" +
          version.slice(0, 3) +
          ".json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as View;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing three-life projection.");
  return value;
}

for (const reducedMotion of [false, true]) {
  test(`bomberman three-life damage keeps control, centers sprites and renders directional fire with reduced motion ${reducedMotion}`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
    const { surface, push, messages } = await openPlaySurface(
      page,
      "bomberman",
      "1.1.0",
      { reducedMotion },
    );
    const view = await fixture();
    const player = required(view.players[0]);
    Object.assign(player, { x: 1800, y: 4200, lives: 3, invulnerableTicks: 0 });
    view.bombs = [];
    view.pickups = [];
    view.events = [];
    view.flames = [
      { cell: 16, shape: "center", remainingTicks: 30 },
      { cell: 17, shape: "horizontal", remainingTicks: 30 },
      { cell: 29, shape: "vertical", remainingTicks: 30 },
    ];
    for (const flame of view.flames) view.arena.tiles[flame.cell] = "floor";
    await push(view, { tick: 180 });
    await expect(
      surface.getByRole("group", { name: "剩余生命", exact: true }),
    ).toBeVisible();
    await expect(surface.locator("#bout-label")).toHaveText(
      "一局三命 · 最后存活者胜",
    );
    await surface.locator("#arena-canvas").focus();
    await page.keyboard.down("KeyD");
    await expect(surface.locator("#joystick")).toHaveAttribute(
      "data-direction",
      "right",
    );
    Object.assign(player, { lives: 2, invulnerableTicks: 120 });
    await push(view, { tick: 183 });
    await expect(surface.getByTestId("player-score-0")).toHaveAttribute(
      "data-lives",
      "2",
    );
    await expect(surface.locator("#joystick")).toHaveAttribute(
      "data-direction",
      "right",
    );
    await expect(surface.locator("#bomb-button")).toBeEnabled();
    await expect(
      surface.getByTestId("player-score-0").locator(".player-state"),
    ).toHaveText("无敌");
    await page.clock.runFor(60);
    const sample = (x: number, y: number) =>
      surface.locator("#arena-canvas canvas").evaluate(
        (element, point) => {
          const context = (element as HTMLCanvasElement).getContext("2d");
          if (!context) throw new Error("No pixel canvas.");
          return [...context.getImageData(point.x, point.y, 1, 1).data].slice(
            0,
            3,
          );
        },
        { x, y },
      );
    const fire = [255, 247, 195];
    expect(await sample(112, 33)).toEqual(fire);
    expect(await sample(129, 48)).toEqual(fire);
    expect(await sample(144, 33)).not.toEqual(fire);
    expect(await sample(112, 65)).toEqual(fire);
    expect(await sample(97, 80)).not.toEqual(fire);
    const solid = await sample(48, 112);
    const footprint = await sample(38, 120);
    player.invulnerableTicks = 108;
    await push(view, { tick: 186 });
    await page.clock.runFor(60);
    const faded = await sample(48, 112);
    if (reducedMotion) expect(faded).toEqual(solid);
    else expect(faded).not.toEqual(solid);
    expect(await sample(38, 120)).toEqual(footprint);
    player.invulnerableTicks = 96;
    await push(view, { tick: 189 });
    await page.clock.runFor(60);
    expect(await sample(48, 112)).toEqual(solid);
    Object.assign(player, { lives: 0, alive: false, invulnerableTicks: 0 });
    await push(view, { tick: 192 });
    await expect(surface.locator("#bomb-button")).toBeDisabled();
    await expect(surface.locator("#joystick")).toHaveAttribute(
      "data-direction",
      "none",
    );
    await expect(surface.locator("#phase-label")).toContainText("生命耗尽");
    await page.keyboard.up("KeyD");
    view.players.forEach((entry) =>
      Object.assign(entry, {
        alive: entry.index === 1,
        lives: entry.index === 1 ? 3 : 0,
        invulnerableTicks: 0,
      }),
    );
    view.phase = "COMPLETE";
    view.outcome = {
      type: "WIN",
      winnerSlotId: "p1",
      reason: "SURVIVOR",
      standings: view.players.map(({ slotId, lives, resigned }) => ({
        slotId,
        lives,
        resigned,
      })),
    };
    await push(view, { tick: 195 });
    await expect
      .poll(async () =>
        (await messages()).filter(
          (value) =>
            (value as { type: string }).type === "surface.result-summary",
        ),
      )
      .toEqual([
        expect.objectContaining({
          tone: "loss",
          details: expect.arrayContaining(["P2 · 3 条命", "成为最后的幸存者"]),
        }),
      ]);
  });
}

test("bomberman 1.2.0 renders dropped upgrades and reduced capacity without clearing held movement", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  const { surface, push } = await openPlaySurface(page, "bomberman", "1.2.0");
  const view = await fixture("1.2.0");
  const actor = required(view.players[0]);
  Object.assign(actor, {
    capacity: 4,
    activeBombs: 4,
    lives: 3,
    invulnerableTicks: 0,
  });
  view.bombs = [14, 16, 22, 126].map((cell, index) => ({
    id: index + 1,
    cell,
    ownerSlotId: actor.slotId,
    fuseTicks: 100,
  }));
  view.arena.tiles[70] = "floor";
  view.flames = [];
  view.pickups = [];
  view.events = [];
  await push(view, { tick: 180 });
  await expect(surface.locator("#inventory")).toContainText("炸弹 4/4");
  await surface.locator("#arena-canvas").focus();
  await page.keyboard.down("KeyD");
  Object.assign(actor, { capacity: 3, lives: 2, invulnerableTicks: 120 });
  view.pickups = [{ cell: 70, kind: "capacity" }];
  await push(view, { tick: 183 });
  await expect(surface.locator("#inventory")).toContainText("炸弹 4/3");
  await expect(surface.locator("#joystick")).toHaveAttribute(
    "data-direction",
    "right",
  );
  await expect(surface.getByTestId("player-score-0")).toHaveAttribute(
    "data-lives",
    "2",
  );
  await page.clock.runFor(60);
  const sample = () =>
    surface.locator("#arena-canvas canvas").evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("2d");
      if (!context) throw new Error("Missing pixel canvas");
      return [...context.getImageData(176, 176, 1, 1).data].slice(0, 3);
    });
  expect(await sample()).toEqual([54, 90, 137]);
  Object.assign(actor, { capacity: 4, invulnerableTicks: 117 });
  view.pickups = [];
  await push(view, { tick: 186 });
  await expect(surface.locator("#inventory")).toContainText("炸弹 4/4");
  await page.clock.runFor(60);
  expect(await sample()).not.toEqual([54, 90, 137]);
  await page.keyboard.up("KeyD");
});

interface AudioProbe {
  tones: string[];
  buffers: { startedAt: number; stops: (number | null)[]; ended: boolean }[];
}
interface AudioWindow extends Window {
  bombermanAudioProbe: AudioProbe;
}

test("bomberman native audio bubbles once, sustains overlapping flames, and silences on blur, reconnect, mute and disposal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe: AudioProbe = { tones: [], buffers: [] };
    (window as unknown as AudioWindow).bombermanAudioProbe = probe;
    const oscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const voice = oscillator.call(this);
      const start = voice.start.bind(voice);
      voice.start = (when) => {
        probe.tones.push(voice.type);
        start(when);
      };
      return voice;
    };
    const bufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const voice = bufferSource.call(this);
      const record = {
        startedAt: this.currentTime,
        stops: [] as (number | null)[],
        ended: false,
      };
      probe.buffers.push(record);
      const stop = voice.stop.bind(voice);
      voice.stop = (when) => {
        record.stops.push(when ?? null);
        stop(when);
      };
      voice.addEventListener("ended", () => {
        record.ended = true;
      });
      return voice;
    };
  });
  const { surface, push, dispose } = await openPlaySurface(
    page,
    "bomberman",
    "1.1.0",
  );
  const view = await fixture();
  const flames = view.flames;
  view.events = [];
  view.flames = [];
  await push(view, { tick: 180 });
  await surface.getByRole("button", { name: "音效", exact: true }).click();
  await expect(surface.locator("#audio-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const probe = () =>
    surface
      .locator("#root")
      .evaluate(() => (window as unknown as AudioWindow).bombermanAudioProbe);
  view.events = [{ id: 1, kind: "place", x: 1800, y: 1800 }];
  await push(view, { tick: 181 });
  await expect.poll(async () => (await probe()).tones).toEqual(["sine"]);
  await push(view, { tick: 182 });
  await expect(surface.locator("#root")).toHaveAttribute("data-tick", "182");
  expect((await probe()).tones).toEqual(["sine"]);
  let tick = 183;
  async function fire(id: number, count: number) {
    view.events = [{ id, kind: "explode", x: 1800, y: 1800 }];
    view.flames = flames.map((flame) => ({ ...flame, remainingTicks: 30 }));
    await push(view, { tick });
    tick += 3;
    await expect.poll(async () => (await probe()).buffers.length).toBe(count);
  }
  await fire(2, 1);
  const first = required((await probe()).buffers[0]);
  expect((first.stops[0] ?? 0) - first.startedAt).toBeCloseTo(0.5, 1);
  expect(first.ended).toBe(false);
  await fire(3, 1);
  const extended = required((await probe()).buffers[0]);
  expect(extended.stops.at(-1)).toBeGreaterThanOrEqual(first.stops[0] ?? 0);
  await expect.poll(async () => (await probe()).buffers[0]?.ended).toBe(true);
  await fire(4, 2);
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await expect
    .poll(async () => (await probe()).buffers[1]?.stops.at(-1))
    .toBeNull();
  await surface.locator("#arena-canvas").focus();
  await push(view, { tick });
  tick += 3;
  await expect(surface.locator("#root")).toHaveAttribute(
    "data-tick",
    String(tick - 3),
  );
  expect((await probe()).buffers).toHaveLength(2);
  await fire(5, 3);
  await push(view, { tick, connectionState: "reconnecting" });
  tick += 3;
  await expect
    .poll(async () => (await probe()).buffers[2]?.stops.at(-1))
    .toBeNull();
  await push(view, { tick });
  tick += 3;
  await expect(surface.locator("#connection-cover")).toBeHidden();
  expect((await probe()).buffers).toHaveLength(3);
  await fire(6, 4);
  await surface.locator("#audio-toggle").click();
  await expect(surface.locator("#audio-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect((await probe()).buffers[3]?.stops.at(-1)).toBeNull();
  await surface.locator("#audio-toggle").click();
  await expect(surface.locator("#audio-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await push(view, { tick });
  tick += 3;
  await expect(surface.locator("#root")).toHaveAttribute(
    "data-tick",
    String(tick - 3),
  );
  expect((await probe()).buffers).toHaveLength(4);
  await fire(7, 5);
  await dispose();
  await expect
    .poll(async () => (await probe()).buffers[4]?.stops.at(-1))
    .toBeNull();
});
