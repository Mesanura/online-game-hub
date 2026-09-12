import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

interface PlayTestWindow extends Window {
  playTestPort: MessagePort;
  playTestSequence: number;
  playTestIntents: unknown[];
}

// A real sandboxed artifact and MessageChannel, using only public projections.
export async function openPlaySurface(
  page: Page,
  gameId: "badminton" | "tank-maze",
  gameVersion: string,
) {
  const origin = "http://play-surface.test";
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") {
      await route.fulfill({
        contentType: "text/html",
        body: '<style>body{margin:0}iframe{width:100%;height:100dvh;border:0;display:block}</style><iframe sandbox="allow-scripts" src="/play/index.html"></iframe>',
      });
      return;
    }
    if (path !== "/play/index.html" && !/^\/assets\/[\w.-]+$/.test(path)) {
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
  const surface = page.frameLocator("iframe");
  await expect(surface.locator("#root > main")).toBeVisible();
  await page.evaluate(
    async ({ gameId, gameVersion }) => {
      const frame = document.querySelector("iframe");
      if (!frame?.contentWindow) throw new Error("Missing Surface frame.");
      const channel = new MessageChannel();
      const host = window as unknown as PlayTestWindow;
      host.playTestPort = channel.port1;
      host.playTestSequence = 0;
      host.playTestIntents = [];
      await new Promise<void>((resolve) => {
        channel.port1.onmessage = (event) => {
          if (event.data.type === "surface.intent")
            host.playTestIntents.push(event.data.intent);
          if (event.data.type !== "surface.ready") return;
          channel.port1.postMessage({
            type: "host.init",
            bridgeVersion: 2,
            gameId,
            gameVersion,
            mode: "play",
            locale: "zh-CN",
            reducedMotion: true,
          });
          resolve();
        };
        frame.contentWindow?.postMessage(
          {
            type: "host.hello",
            bridgeVersion: 2,
            mode: "play",
            nonce: "play-controls-test-000000000000000000",
          },
          "*",
          [channel.port2],
        );
      });
    },
    { gameId, gameVersion },
  );
  return {
    surface,
    async push(
      payload: unknown,
      options: {
        connectionState?: "connected" | "reconnecting";
        roundNumber?: number;
        readOnly?: boolean;
      } = {},
    ) {
      await page.evaluate(
        ({ payload, options }) => {
          const host = window as unknown as PlayTestWindow;
          host.playTestPort.postMessage({
            type: "host.state",
            sequence: ++host.playTestSequence,
            connectionState: "connected",
            roundNumber: 1,
            readOnly: false,
            ...options,
            payload,
          });
        },
        { payload, options },
      );
    },
    async intents(): Promise<unknown[]> {
      return page.evaluate(
        () => (window as unknown as PlayTestWindow).playTestIntents,
      );
    },
    async dispose() {
      await page.evaluate(() =>
        (window as unknown as PlayTestWindow).playTestPort.postMessage({
          type: "host.dispose",
        }),
      );
    },
  };
}
