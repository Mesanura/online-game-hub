export type CreateGameErrorCode =
  | "INVALID_ARGUMENTS"
  | "INVALID_GAME_ID"
  | "WORKSPACE_INVALID"
  | "CONFLICT"
  | "LOCKFILE_UPDATE_FAILED"
  | "WRITE_FAILED";

export class CreateGameError extends Error {
  override readonly name = "CreateGameError";
  readonly code: CreateGameErrorCode;
  readonly exitCode: 1 | 2;

  constructor(code: CreateGameErrorCode, message: string, exitCode: 1 | 2) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}
