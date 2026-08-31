import type { StoredGameRoom } from "./room-store.js";

export interface MatchArchive {
  createRound(room: StoredGameRoom): Promise<void>;
  saveRound(room: StoredGameRoom): Promise<void>;
}

export class NoopMatchArchive implements MatchArchive {
  public async createRound(room: StoredGameRoom): Promise<void> {
    void room;
  }

  public async saveRound(room: StoredGameRoom): Promise<void> {
    void room;
  }
}
