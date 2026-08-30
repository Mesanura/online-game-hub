import { eraseGameClientModule } from "@online-game-hub/game-client-sdk";
import type { UnknownGameClientModule } from "@online-game-hub/game-client-sdk";
import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";

const loadConnectFourEntrypoint = () =>
  import("@online-game-hub/connect-four/client");
const loadTicTacToeEntrypoint = () =>
  import("@online-game-hub/tic-tac-toe/client");

interface ClientRegistration {
  readonly gameId: string;
  readonly gameVersion: string;
  loadEntrypoint(): Promise<unknown>;
  loadModule(): Promise<UnknownGameClientModule>;
}

const clientRegistrations = Object.freeze([
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
    gameVersion: connectFourManifest.gameVersion,
    loadEntrypoint: loadConnectFourEntrypoint,
    loadModule: async (): Promise<UnknownGameClientModule> =>
      eraseGameClientModule(
        (await loadConnectFourEntrypoint()).connectFourClientModule,
      ),
  },
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
