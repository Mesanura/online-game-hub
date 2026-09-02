import { eraseGameClientModule } from "@online-game-hub/game-client-sdk";
import type { UnknownGameClientModule } from "@online-game-hub/game-client-sdk";
import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { gomokuManifest } from "@online-game-hub/gomoku/manifest";
import { hexManifest } from "@online-game-hub/hex/manifest";
import { reversiManifest } from "@online-game-hub/reversi/manifest";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";
// create-game:client-manifest-import

const loadConnectFourEntrypoint = () =>
  import("@online-game-hub/connect-four/client");
const loadConnectFourHistoricalEntrypoint = () =>
  import("@online-game-hub/connect-four/client");
const loadGomokuEntrypoint = () => import("@online-game-hub/gomoku/client");
const loadGomokuHistoricalEntrypoint = () =>
  import("@online-game-hub/gomoku/client");
const loadHexEntrypoint = () => import("@online-game-hub/hex/client");
const loadReversiEntrypoint = () => import("@online-game-hub/reversi/client");
const loadReversiHistoricalEntrypoint = () =>
  import("@online-game-hub/reversi/client");
const loadTicTacToeEntrypoint = () =>
  import("@online-game-hub/tic-tac-toe/client");
const loadTicTacToeHistoricalEntrypoint = () =>
  import("@online-game-hub/tic-tac-toe/client");
// create-game:client-loader

interface ClientRegistration {
  readonly gameId: string;
  readonly gameVersion: string;
  loadEntrypoint(): Promise<unknown>;
  loadModule(): Promise<UnknownGameClientModule>;
}

const clientRegistrations = Object.freeze([
  {
    gameId: ticTacToeManifest.id,
    gameVersion: "1.0.0",
    loadEntrypoint: loadTicTacToeHistoricalEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadTicTacToeHistoricalEntrypoint()).ticTacToeClientModuleV1_0_0,
      ),
  },
  {
    gameId: ticTacToeManifest.id,
    gameVersion: ticTacToeManifest.gameVersion,
    loadEntrypoint: loadTicTacToeEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadTicTacToeEntrypoint()).ticTacToeClientModule,
      ),
  },
  {
    gameId: connectFourManifest.id,
    gameVersion: "1.0.0",
    loadEntrypoint: loadConnectFourHistoricalEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadConnectFourHistoricalEntrypoint())
          .connectFourClientModuleV1_0_0,
      ),
  },
  {
    gameId: connectFourManifest.id,
    gameVersion: connectFourManifest.gameVersion,
    loadEntrypoint: loadConnectFourEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadConnectFourEntrypoint()).connectFourClientModule,
      ),
  },
  {
    gameId: gomokuManifest.id,
    gameVersion: "1.0.0",
    loadEntrypoint: loadGomokuHistoricalEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadGomokuHistoricalEntrypoint()).gomokuClientModuleV1_0_0,
      ),
  },
  {
    gameId: gomokuManifest.id,
    gameVersion: gomokuManifest.gameVersion,
    loadEntrypoint: loadGomokuEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule((await loadGomokuEntrypoint()).gomokuClientModule),
  },
  {
    gameId: hexManifest.id,
    gameVersion: "1.0.0",
    loadEntrypoint: loadHexEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule((await loadHexEntrypoint()).hexClientModuleV1_0_0),
  },
  {
    gameId: reversiManifest.id,
    gameVersion: "1.0.0",
    loadEntrypoint: loadReversiHistoricalEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadReversiHistoricalEntrypoint()).reversiClientModuleV1_0_0,
      ),
  },
  {
    gameId: hexManifest.id,
    gameVersion: hexManifest.gameVersion,
    loadEntrypoint: loadHexEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule((await loadHexEntrypoint()).hexClientModule),
  },
  {
    gameId: reversiManifest.id,
    gameVersion: reversiManifest.gameVersion,
    loadEntrypoint: loadReversiEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadReversiEntrypoint()).reversiClientModule,
      ),
  },
  // create-game:client-registration
]) satisfies readonly ClientRegistration[];

function findRegistration(gameId: string, gameVersion: string) {
  return clientRegistrations.find(
    (candidate) =>
      candidate.gameId === gameId && candidate.gameVersion === gameVersion,
  );
}

export async function loadGameClientEntrypoint(
  gameId: string,
  gameVersion: string,
): Promise<unknown | undefined> {
  return findRegistration(gameId, gameVersion)?.loadEntrypoint();
}

export async function loadGameClientModule(
  gameId: string,
  gameVersion: string,
): Promise<UnknownGameClientModule | undefined> {
  return findRegistration(gameId, gameVersion)?.loadModule();
}
