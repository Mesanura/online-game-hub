import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://setup-surface.test";
interface SetupTestWindow extends Window {
  setupTestPort: MessagePort;
  setupTestSequence: number;
  setupTestIntents: { clientIntentId: string; intent: unknown }[];
}
const standard = {
  starter: "OWNER",
  fixedStarterSlotId: null,
  participantSlotIds: ["owner", "guest"],
  canEdit: true,
};
const chinese = {
  targetPlayerCount: 2,
  starter: "CAMP",
  fixedStarterSlotId: null,
  starterCamp: "N",
  participants: [
    { slotId: "owner", isOwner: true, camp: "N" },
    { slotId: "guest", isOwner: false, camp: "S" },
  ],
  canEditRules: true,
  canSelectCamp: true,
  yourCamp: "N",
};
const tank = {
  config: { playerCount: 2, targetScore: 5, colors: [] },
  colors: { owner: 0, guest: 1 },
  players: [
    { slotId: "owner", color: 0 },
    { slotId: "guest", color: 1 },
  ],
  participantSlotIds: ["owner", "guest"],
  canEdit: true,
  selfSlotId: "owner",
};
interface SetupCase {
  gameId: string;
  selector: string;
  payload: Record<string, unknown>;
  accepted: Record<string, unknown>;
  conflictCode?: string;
}
const cases: readonly SetupCase[] = [
  ...[
    "tic-tac-toe",
    "connect-four",
    "gomoku",
    "hex",
    "reversi",
    "pong",
    "badminton",
  ].map((gameId) => {
    const payload = {
      ...standard,
      ...(gameId === "gomoku"
        ? { config: { boardSize: 15, winLength: 5 } }
        : {}),
      ...(gameId === "pong" ? { config: { targetScore: 3 } } : {}),
      ...(gameId === "badminton" ? { config: { targetScore: 7 } } : {}),
    };
    return {
      gameId,
      selector:
        gameId === "tic-tac-toe"
          ? 'button:has-text("随机先手")'
          : '[data-starter="RANDOM"]',
      payload,
      accepted: { ...payload, starter: "RANDOM" },
    };
  }),
  {
    gameId: "chinese-checkers",
    selector: '[data-starter="RANDOM"]',
    payload: chinese,
    accepted: { ...chinese, starter: "RANDOM", starterCamp: null },
    conflictCode: "CAMP_TAKEN",
  },
  {
    gameId: "tank-maze",
    selector: '[data-color="2"]',
    payload: tank,
    accepted: {
      ...tank,
      colors: { owner: 2, guest: 1 },
      players: [
        { slotId: "owner", color: 2 },
        { slotId: "guest", color: 1 },
      ],
    },
    conflictCode: "COLOR_TAKEN",
  },
];

async function mountSetup(
  page: Page,
  gameId: string,
  payload: unknown,
  version?: string,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        `../../../game-surfaces/${gameId}/dist/surface.manifest.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { supportedGameVersions: string[] };
  const gameVersion = version ?? manifest.supportedGameVersions.at(-1);
  if (gameVersion === undefined)
    throw new Error("Missing supported game version.");
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") {
      await route.fulfill({
        contentType: "text/html",
        body: '<style>body{margin:0}iframe{width:100%;height:100dvh;border:0;display:block}</style><iframe sandbox="allow-scripts" src="/setup/index.html"></iframe>',
      });
      return;
    }
    if (path !== "/setup/index.html" && !/^\/assets\/[\w.-]+$/.test(path)) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      contentType: path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
      body: await readFile(
        new URL(
          `../../../game-surfaces/${gameId}/dist${path}`,
          import.meta.url,
        ),
      ),
    });
  });
  await page.goto(origin);
  await page.evaluate(
    async ({ gameId, gameVersion }) => {
      const frame = document.querySelector("iframe");
      if (!frame?.contentWindow) throw new Error("Missing Surface frame.");
      const channel = new MessageChannel();
      const host = window as unknown as SetupTestWindow;
      Object.assign(host, {
        setupTestPort: channel.port1,
        setupTestSequence: 0,
        setupTestIntents: [],
      });
      await new Promise<void>((resolve) => {
        channel.port1.onmessage = (event) => {
          if (event.data.type === "surface.intent")
            host.setupTestIntents.push(event.data);
          if (event.data.type !== "surface.ready") return;
          channel.port1.postMessage({
            type: "host.init",
            bridgeVersion: 2,
            gameId,
            gameVersion,
            mode: "setup",
            locale: "zh-CN",
            reducedMotion: true,
          });
          resolve();
        };
        frame.contentWindow?.postMessage(
          {
            type: "host.hello",
            bridgeVersion: 2,
            mode: "setup",
            nonce: "setup-feedback-test-0000000000000000",
          },
          "*",
          [channel.port2],
        );
      });
    },
    { gameId, gameVersion },
  );
  await pushState(page, payload);
  await expect(
    page.frameLocator("iframe").locator(".setup-card"),
  ).toBeVisible();
}

async function pushState(
  page: Page,
  payload: unknown,
  options: {
    connectionState?: "connected" | "reconnecting";
    readOnly?: boolean;
    roundNumber?: number;
  } = {},
): Promise<void> {
  await page.evaluate(
    ({ payload, options }) => {
      const host = window as unknown as SetupTestWindow;
      host.setupTestPort.postMessage({
        type: "host.state",
        sequence: ++host.setupTestSequence,
        connectionState: "connected",
        readOnly: false,
        roundNumber: 1,
        ...options,
        payload,
      });
    },
    { payload, options },
  );
}

async function reply(
  page: Page,
  clientIntentId: string,
  status: "accepted" | "rejected" | "stale",
  code?: string,
): Promise<void> {
  await page.evaluate(
    (message) => {
      (window as unknown as SetupTestWindow).setupTestPort.postMessage(message);
    },
    {
      type: "host.intent-result",
      clientIntentId,
      status,
      ...(code === undefined ? {} : { code }),
    },
  );
}

for (const entry of cases) {
  test(`${entry.gameId} Setup correlates feedback and recovers from stale, delayed and disconnected commands`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mountSetup(page, entry.gameId, entry.payload);
    const surface = page.frameLocator("iframe");
    const control = surface.locator(entry.selector);
    let sent = 0;
    const submit = async () => {
      await expect(control).toBeEnabled();
      await control.focus();
      await control.press("Enter");
      await expect(control).toBeDisabled();
      sent++;
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as SetupTestWindow).setupTestIntents.length,
          ),
        )
        .toBe(sent);
      const id = await page.evaluate(
        () =>
          (window as unknown as SetupTestWindow).setupTestIntents.at(-1)
            ?.clientIntentId,
      );
      if (id === undefined) throw new Error("Missing Setup intent.");
      return id;
    };
    const first = await submit();
    await expect(control).toHaveAttribute("aria-pressed", "false");
    await expect(control).toBeFocused();
    await control.press("Enter");
    await reply(page, "unrelated-command", "rejected", "NOT_OWNER");
    await pushState(page, entry.payload);
    await expect(control).toBeDisabled();
    await expect(control).toBeFocused();
    expect(
      await page.evaluate(
        () => (window as unknown as SetupTestWindow).setupTestIntents.length,
      ),
    ).toBe(1);
    await reply(page, first, "rejected", "NOT_OWNER");
    await expect(control).toBeEnabled();
    await expect(
      surface.getByRole("status").filter({ hasText: "只有房主" }),
    ).toBeVisible();
    await expect(control).toHaveAttribute("aria-pressed", "false");
    const second = await submit();
    await reply(page, second, "accepted");
    await expect(control).toBeEnabled();
    await expect(control).toHaveAttribute("aria-pressed", "false");
    await pushState(page, entry.accepted);
    await expect(control).toHaveAttribute("aria-pressed", "true");
    await expect(control).toBeFocused();
    await pushState(page, entry.payload);
    const failures = [
      {
        status: "stale" as const,
        code: "STALE_SETUP_REVISION",
        text: "设置已被更新",
      },
      {
        status: "rejected" as const,
        code: "HOST_REJECTED",
        text: "连接未能确认设置",
      },
      {
        status: "rejected" as const,
        code: "UNKNOWN_INTERNAL_ERROR",
        text: "未被接受",
      },
      ...(entry.conflictCode === undefined
        ? []
        : [
            {
              status: "rejected" as const,
              code: entry.conflictCode,
              text: "已被其他玩家",
            },
          ]),
    ];
    for (const failure of failures) {
      const id = await submit();
      await reply(page, id, failure.status, failure.code);
      await expect(control).toBeEnabled();
      await expect(
        surface.getByRole("status").filter({ hasText: failure.text }),
      ).toBeVisible();
      await expect(control).toHaveAttribute("aria-pressed", "false");
      await expect(control).toBeFocused();
    }
    const disconnected = await submit();
    await pushState(page, entry.payload, { connectionState: "reconnecting" });
    await expect(control).toBeDisabled();
    await pushState(page, entry.payload);
    const retry = await submit();
    await reply(page, disconnected, "accepted");
    await expect(control).toBeDisabled();
    await reply(page, retry, "accepted");
    await expect(control).toBeEnabled();
    const oldRound = await submit();
    await pushState(page, entry.payload, { roundNumber: 2 });
    await expect(control).toBeEnabled();
    await reply(page, oldRound, "rejected", "NOT_OWNER");
    await expect(
      surface.getByRole("status").filter({ hasText: "只有房主" }),
    ).toHaveCount(0);
    await pushState(page, entry.payload, { roundNumber: 2, readOnly: true });
    await expect(control).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

for (const gameVersion of ["1.0.0", "1.1.0", "1.2.0"]) {
  test(`badminton ${gameVersion} Setup explains its exact serving rule`, async ({
    page,
  }) => {
    await mountSetup(
      page,
      "badminton",
      { ...standard, config: { targetScore: 11 } },
      gameVersion,
    );
    const surface = page.frameLocator("iframe");
    await expect(surface.getByTestId("setup-preview")).toHaveAttribute(
      "data-score-cap",
      "15",
    );
    await expect(surface.getByTestId("setup-preview")).toHaveAttribute(
      "data-serve-mode",
      gameVersion === "1.0.0" ? "automatic" : "manual",
    );
    await expect(surface.getByTestId("serve-rule")).toContainText(
      gameVersion === "1.0.0" ? "准备倒计时结束后开球" : "发球方按 S",
    );
    await expect(
      surface.locator(".how-to kbd").filter({ hasText: /^S$/ }),
    ).toHaveCount(gameVersion === "1.0.0" ? 0 : 1);
  });
}
