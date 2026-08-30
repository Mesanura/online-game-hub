export type DatabaseErrorCode =
  | "DATABASE_CONFIGURATION_ERROR"
  | "DATABASE_CONNECTION_ERROR"
  | "DATABASE_DATA_INVALID"
  | "DATABASE_MIGRATION_ERROR"
  | "DATABASE_OPERATION_ERROR";

export class DatabaseError extends Error {
  public constructor(public readonly code: DatabaseErrorCode) {
    super(code);
    this.name = "DatabaseError";
  }
}
