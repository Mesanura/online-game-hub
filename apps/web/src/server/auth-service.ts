import "server-only";

import {
  AccountRepositoryError,
  PostgresAccountRepository,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import type { AccountSessionRecord } from "@online-game-hub/database";

import {
  createAccountSessionMaterial,
  hashAccountSessionToken,
} from "./account-session";
import {
  hashPassword,
  getDummyPasswordHash,
  normalizeUsername,
  verifyPassword,
} from "./password-auth";
import type { WebServerConfig } from "./config";
import { normalizeDisplayName } from "../lib/profile";

export type AuthServiceErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "USERNAME_UNAVAILABLE"
  | "AUTH_DATABASE_UNAVAILABLE"
  | "SESSION_INVALID"
  | "PASSWORD_INVALID";

export class AuthServiceError extends Error {
  public constructor(public readonly code: AuthServiceErrorCode) {
    super(code);
    this.name = "AuthServiceError";
  }
}

export interface PublicAccount {
  readonly username: string;
  readonly displayName: string;
}

export interface AuthenticatedAccount {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly session: AccountSessionRecord;
  readonly sessionToken: string | null;
}

function requireDatabase(config: WebServerConfig) {
  if (config.databaseMode !== "postgres" || config.databaseUrl === null) {
    throw new AuthServiceError("AUTH_DATABASE_UNAVAILABLE");
  }
  return createPostgresDatabaseClient({
    url: config.databaseUrl,
    applicationName: "online-game-hub-web-auth",
    maxConnections: 4,
  });
}

export async function registerAccount(
  config: WebServerConfig,
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<AuthenticatedAccount> {
  const username = normalizeUsername(usernameInput);
  if (username === null) throw new AuthServiceError("INVALID_INPUT");
  if (typeof passwordInput !== "string") {
    throw new AuthServiceError("INVALID_INPUT");
  }
  try {
    const passwordHash = await hashPassword(passwordInput);
    const material = createAccountSessionMaterial();
    const client = requireDatabase(config);
    try {
      const session = await new PostgresAccountRepository(
        client.database,
      ).registerPasswordAccount(username, passwordHash, material);
      return {
        userId: session.userId,
        username,
        displayName: session.displayName,
        session,
        sessionToken: material.token,
      };
    } finally {
      await client.close();
    }
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    if (
      error instanceof AccountRepositoryError &&
      error.code === "USERNAME_UNAVAILABLE"
    ) {
      throw new AuthServiceError("USERNAME_UNAVAILABLE");
    }
    if (error instanceof TypeError) {
      throw new AuthServiceError("PASSWORD_INVALID");
    }
    throw new AuthServiceError("AUTH_DATABASE_UNAVAILABLE");
  }
}

export async function loginAccount(
  config: WebServerConfig,
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<AuthenticatedAccount> {
  const username = normalizeUsername(usernameInput);
  if (username === null || typeof passwordInput !== "string") {
    throw new AuthServiceError("INVALID_CREDENTIALS");
  }
  const client = requireDatabase(config);
  try {
    const repository = new PostgresAccountRepository(client.database);
    const account = await repository.findPasswordAccountByUsername(username);
    const verified = await verifyPassword(
      account?.passwordHash ?? (await getDummyPasswordHash()),
      passwordInput,
    );
    if (!verified || account === null) {
      throw new AuthServiceError("INVALID_CREDENTIALS");
    }
    const material = createAccountSessionMaterial();
    const session = await repository.createAccountSession(
      account.userId,
      material,
    );
    return {
      userId: account.userId,
      username: account.username,
      displayName: account.displayName,
      session,
      sessionToken: material.token,
    };
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    throw new AuthServiceError("AUTH_DATABASE_UNAVAILABLE");
  } finally {
    await client.close();
  }
}

export async function resolveAccountSession(
  config: WebServerConfig,
  token: unknown,
): Promise<AuthenticatedAccount | null> {
  const tokenHash = hashAccountSessionToken(token);
  if (tokenHash === null) return null;
  const client = requireDatabase(config);
  try {
    const session = await new PostgresAccountRepository(
      client.database,
    ).resolveAccountSession(tokenHash, new Date());
    return session === null
      ? null
      : {
          userId: session.userId,
          username: session.username,
          displayName: session.displayName,
          session,
          sessionToken: null,
        };
  } finally {
    await client.close();
  }
}

export async function logoutAccount(
  config: WebServerConfig,
  token: unknown,
): Promise<void> {
  const tokenHash = hashAccountSessionToken(token);
  if (tokenHash === null) return;
  const client = requireDatabase(config);
  try {
    await new PostgresAccountRepository(client.database).deleteAccountSession(
      tokenHash,
    );
  } finally {
    await client.close();
  }
}

export async function changeAccountPassword(
  config: WebServerConfig,
  account: AuthenticatedAccount,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<void> {
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    throw new AuthServiceError("INVALID_INPUT");
  }
  const client = requireDatabase(config);
  try {
    const repository = new PostgresAccountRepository(client.database);
    const credentials = await repository.findPasswordAccountByUsername(
      account.username,
    );
    if (
      credentials === null ||
      !(await verifyPassword(credentials.passwordHash, currentPassword))
    ) {
      throw new AuthServiceError("INVALID_CREDENTIALS");
    }
    const newHash = await hashPassword(newPassword);
    await repository.changePasswordAndRevokeOtherSessions(
      account.userId,
      credentials.passwordHash,
      newHash,
      account.session.tokenHash,
    );
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    if (error instanceof TypeError)
      throw new AuthServiceError("PASSWORD_INVALID");
    throw new AuthServiceError("AUTH_DATABASE_UNAVAILABLE");
  } finally {
    await client.close();
  }
}

export async function updateAccountProfile(
  config: WebServerConfig,
  account: AuthenticatedAccount,
  displayNameInput: unknown,
): Promise<PublicAccount> {
  const displayName = normalizeDisplayName(displayNameInput);
  if (displayName === null) throw new AuthServiceError("INVALID_INPUT");
  const client = requireDatabase(config);
  try {
    await new PostgresAccountRepository(client.database).updateDisplayName(
      account.userId,
      displayName,
    );
    return { username: account.username, displayName };
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    throw new AuthServiceError("AUTH_DATABASE_UNAVAILABLE");
  } finally {
    await client.close();
  }
}

export function publicAccount(account: AuthenticatedAccount): PublicAccount {
  return { username: account.username, displayName: account.displayName };
}
