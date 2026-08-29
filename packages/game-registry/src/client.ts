import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";

interface ClientRegistration {
  readonly gameId: string;
  readonly gameVersion: string;
  load(): Promise<unknown>;
}

const clientRegistrations = Object.freeze([
  {
    gameId: ticTacToeManifest.id,
    gameVersion: ticTacToeManifest.gameVersion,
    load: async (): Promise<unknown> =>
      import("@online-game-hub/tic-tac-toe/client"),
  },
]) satisfies readonly ClientRegistration[];

export async function loadGameClientEntrypoint(
  gameId: string,
  gameVersion: string,
): Promise<unknown | undefined> {
  const registration = clientRegistrations.find(
    (candidate) =>
      candidate.gameId === gameId && candidate.gameVersion === gameVersion,
  );
  return registration?.load();
}
