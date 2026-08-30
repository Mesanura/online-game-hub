export type WebEnvironment = Readonly<Record<string, string | undefined>>;

export type WebApplicationEnvironment = "development" | "test" | "production";

export type WebDatabaseMode = "memory" | "postgres";

export interface WebServerConfig {
  readonly applicationEnvironment: WebApplicationEnvironment;
  readonly databaseMode: WebDatabaseMode;
  readonly databaseUrl: string | null;
  readonly gameServerPublicUrl: string;
  readonly guestSessionSecret: string;
  readonly guestCookieSecure: boolean;
  readonly ticketIssuer: string;
  readonly ticketSecret: string;
  readonly ticketLifetimeSeconds: number;
}

function databaseConfig(
  environment: WebEnvironment,
  appEnvironment: WebApplicationEnvironment,
): Pick<WebServerConfig, "databaseMode" | "databaseUrl"> {
  const mode = required(environment, "DATABASE_MODE");
  if (mode !== "memory" && mode !== "postgres") {
    throw new Error("DATABASE_MODE must be memory or postgres.");
  }
  if (appEnvironment === "production" && mode !== "postgres") {
    throw new Error("Production Web history persistence must use PostgreSQL.");
  }
  if (mode === "memory") {
    return { databaseMode: mode, databaseUrl: null };
  }
  const rawUrl = required(environment, "DATABASE_URL");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.hostname.length === 0
  ) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  return { databaseMode: mode, databaseUrl: rawUrl };
}

function required(environment: WebEnvironment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function applicationEnvironment(
  environment: WebEnvironment,
): WebApplicationEnvironment {
  const explicit = environment.APP_ENV;
  if (
    explicit === "development" ||
    explicit === "test" ||
    explicit === "production"
  ) {
    return explicit;
  }
  return environment.NODE_ENV === "production"
    ? "production"
    : environment.NODE_ENV === "test"
      ? "test"
      : "development";
}

function publicGameServerUrl(
  environment: WebEnvironment,
  appEnvironment: WebApplicationEnvironment,
): string {
  const rawUrl = required(environment, "GAME_SERVER_PUBLIC_URL");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("GAME_SERVER_PUBLIC_URL must be an absolute URL.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("GAME_SERVER_PUBLIC_URL must be a public HTTP(S) URL.");
  }
  if (appEnvironment === "production" && url.protocol !== "https:") {
    throw new Error("Production GAME_SERVER_PUBLIC_URL must use HTTPS.");
  }
  return url.toString().replace(/\/$/u, "");
}

function booleanValue(
  environment: WebEnvironment,
  name: string,
  fallback: boolean,
): boolean {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function ticketLifetime(environment: WebEnvironment): number {
  const raw = environment.GAME_SERVER_TICKET_LIFETIME_SECONDS ?? "30";
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 300) {
    throw new Error(
      "GAME_SERVER_TICKET_LIFETIME_SECONDS must be an integer from 1 to 300.",
    );
  }
  return value;
}

export function readWebServerConfig(
  environment: WebEnvironment,
): WebServerConfig {
  const appEnvironment = applicationEnvironment(environment);
  const guestCookieSecure = booleanValue(
    environment,
    "GUEST_COOKIE_SECURE",
    appEnvironment === "production",
  );
  if (appEnvironment === "production" && !guestCookieSecure) {
    throw new Error("Production guest cookies must be Secure.");
  }
  return {
    applicationEnvironment: appEnvironment,
    ...databaseConfig(environment, appEnvironment),
    gameServerPublicUrl: publicGameServerUrl(environment, appEnvironment),
    guestSessionSecret: required(environment, "GUEST_SESSION_SECRET"),
    guestCookieSecure,
    ticketIssuer: required(environment, "GAME_SERVER_TICKET_ISSUER"),
    ticketSecret: required(environment, "GAME_SERVER_TICKET_SECRET"),
    ticketLifetimeSeconds: ticketLifetime(environment),
  };
}
