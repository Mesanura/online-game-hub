import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { createProductionGameServer } from "@online-game-hub/game-server";
import type { GameServerApplication } from "@online-game-hub/game-server";
import {
  FakeRuntimeClock,
  createDeterministicRuntimeIdSource,
} from "@online-game-hub/game-server-runtime/testing";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const LOOPBACK_HOST = "127.0.0.1";

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, resolveListening);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("E2E port reservation did not expose a TCP address.");
  }
  await new Promise<void>((resolveClosed, reject) =>
    server.close((error) =>
      error === undefined ? resolveClosed() : reject(error),
    ),
  );
  return address.port;
}

async function waitForWebApplication(
  child: ChildProcess,
  webUrl: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The Next.js E2E process exited before becoming ready.");
    }
    try {
      const response = await fetch(webUrl, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // The randomly allocated loopback port is not accepting requests yet.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Next.js E2E process.");
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => undefined);
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

function startWebApplication(
  webPort: number,
  gameServerPublicUrl: string,
  ticketIssuer: string,
  ticketSecret: string,
): ChildProcess {
  const webDirectory = join(REPOSITORY_ROOT, "apps", "web");
  const nextCli = join(
    webDirectory,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  return spawn(
    process.execPath,
    [nextCli, "start", "--hostname", LOOPBACK_HOST, "--port", String(webPort)],
    {
      cwd: webDirectory,
      env: {
        ...process.env,
        APP_ENV: "test",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        GAME_SERVER_PUBLIC_URL: gameServerPublicUrl,
        GUEST_SESSION_SECRET: randomBytes(32).toString("base64url"),
        GUEST_COOKIE_SECURE: "false",
        GAME_SERVER_TICKET_ISSUER: ticketIssuer,
        GAME_SERVER_TICKET_SECRET: ticketSecret,
        GAME_SERVER_TICKET_LIFETIME_SECONDS: "30",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}

export interface E2eHarness {
  readonly clock: FakeRuntimeClock;
  readonly gameServer: GameServerApplication;
  readonly webUrl: string;
  stop(): Promise<void>;
}

export async function startE2eHarness(): Promise<E2eHarness> {
  const webPort = await reserveLoopbackPort();
  const webUrl = `http://${LOOPBACK_HOST}:${webPort}`;
  const ticketIssuer = `e2e-web-${randomUUID()}`;
  const ticketSecret = randomBytes(32).toString("base64url");
  const clock = new FakeRuntimeClock(Date.now());
  const gameServer = createProductionGameServer(
    {
      applicationEnvironment: "test",
      hostname: LOOPBACK_HOST,
      port: 0,
      ticketIssuer,
      ticketSecret,
      allowedWebOrigins: [webUrl],
      reconnectGraceMilliseconds: 60_000,
    },
    {
      clock,
      ids: createDeterministicRuntimeIdSource([
        "PLAY2345",
        "DRAW2345",
        "ABAN2345",
      ]),
      logger: { write: () => undefined },
    },
  );
  const gameAddress = await gameServer.start();
  const webProcess = startWebApplication(
    webPort,
    gameAddress.httpUrl,
    ticketIssuer,
    ticketSecret,
  );
  webProcess.stdout?.resume();
  webProcess.stderr?.resume();

  try {
    await waitForWebApplication(webProcess, webUrl);
  } catch (error) {
    await Promise.allSettled([stopChildProcess(webProcess), gameServer.stop()]);
    throw error;
  }

  let stopped = false;
  return {
    clock,
    gameServer,
    webUrl,
    async stop() {
      if (stopped) return;
      stopped = true;
      await Promise.allSettled([
        stopChildProcess(webProcess),
        gameServer.stop(),
      ]);
    },
  };
}
