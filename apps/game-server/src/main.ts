import { createProductionGameServer } from "./production.js";
import { readGameServerConfig } from "./config.js";

async function main(): Promise<void> {
  let application: ReturnType<typeof createProductionGameServer> | undefined;
  try {
    const config = readGameServerConfig(process.env);
    application = createProductionGameServer(config);
    const address = await application.start();
    process.stdout.write(
      `${JSON.stringify({
        event: "game-server.started",
        hostname: address.hostname,
        port: address.port,
      })}\n`,
    );
  } catch {
    process.stderr.write(
      `${JSON.stringify({
        event: "game-server.start_failed",
        code: "GAME_SERVER_CONFIGURATION_OR_START_ERROR",
      })}\n`,
    );
    await application?.stop().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  let stopping = false;
  const stop = (signal: "SIGINT" | "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    void application
      .stop()
      .then(() => {
        process.stdout.write(
          `${JSON.stringify({ event: "game-server.stopped", signal })}\n`,
        );
      })
      .catch(() => {
        process.stderr.write(
          `${JSON.stringify({
            event: "game-server.stop_failed",
            code: "GAME_SERVER_STOP_ERROR",
          })}\n`,
        );
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

await main();
