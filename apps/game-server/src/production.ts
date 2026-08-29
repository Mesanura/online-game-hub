import type { GameServerCompositionOptions } from "./server.js";
import { createGameServer } from "./server.js";
import { createGameServerTicketVerifier } from "./ticket-verifier.js";
import type { GameServerConfig } from "./config.js";
import { configureGameServerCors } from "./cors.js";

export type ProductionGameServerOverrides = Omit<
  GameServerCompositionOptions,
  "ticketVerifier" | "reconnectGraceMilliseconds"
>;

export function createProductionGameServer(
  config: GameServerConfig,
  overrides: ProductionGameServerOverrides = {},
) {
  const application = createGameServer({
    ...overrides,
    ticketVerifier: createGameServerTicketVerifier({
      issuer: config.ticketIssuer,
      secret: config.ticketSecret,
    }),
    reconnectGraceMilliseconds: config.reconnectGraceMilliseconds,
  });
  let restoreCors: (() => void) | null = null;

  return {
    roomStore: application.roomStore,
    replayStore: application.replayStore,
    metrics: application.metrics,
    address: () => application.address(),
    async start(options = {}) {
      restoreCors ??= configureGameServerCors(config.allowedWebOrigins);
      try {
        return await application.start({
          hostname: options.hostname ?? config.hostname,
          port: options.port ?? config.port,
        });
      } catch (error) {
        restoreCors();
        restoreCors = null;
        throw error;
      }
    },
    async stop() {
      try {
        await application.stop();
      } finally {
        restoreCors?.();
        restoreCors = null;
      }
    },
  } satisfies ReturnType<typeof createGameServer>;
}
