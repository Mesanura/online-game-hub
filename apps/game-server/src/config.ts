export type GameServerEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type GameServerApplicationEnvironment =
  "development" | "test" | "production";

export interface GameServerConfig {
  readonly applicationEnvironment: GameServerApplicationEnvironment;
  readonly hostname: string;
  readonly port: number;
  readonly ticketIssuer: string;
  readonly ticketSecret: string;
  readonly allowedWebOrigins: readonly string[];
  readonly reconnectGraceMilliseconds: number;
}

function required(environment: GameServerEnvironment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function applicationEnvironment(
  environment: GameServerEnvironment,
): GameServerApplicationEnvironment {
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

function hostname(environment: GameServerEnvironment): string {
  const value = environment.GAME_SERVER_HOST ?? "127.0.0.1";
  if (!/^[A-Za-z0-9.-]+$/u.test(value)) {
    throw new Error("GAME_SERVER_HOST must be an IPv4 address or hostname.");
  }
  return value;
}

function port(
  environment: GameServerEnvironment,
  appEnvironment: GameServerApplicationEnvironment,
): number {
  const value = Number(environment.GAME_SERVER_PORT ?? "2567");
  if (
    !Number.isSafeInteger(value) ||
    value < (appEnvironment === "production" ? 1 : 0) ||
    value > 65_535
  ) {
    throw new Error(
      "GAME_SERVER_PORT must be an integer from 1 to 65535 (or 0 outside production).",
    );
  }
  return value;
}

function isLoopbackHostname(value: string): boolean {
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]";
}

function allowedWebOrigins(
  environment: GameServerEnvironment,
  appEnvironment: GameServerApplicationEnvironment,
): readonly string[] {
  const rawOrigins = required(environment, "GAME_SERVER_ALLOWED_WEB_ORIGINS")
    .split(",")
    .map((value) => value.trim());
  if (rawOrigins.some((value) => value.length === 0)) {
    throw new Error(
      "GAME_SERVER_ALLOWED_WEB_ORIGINS must be a comma-separated origin list.",
    );
  }
  const origins = rawOrigins.map((rawOrigin) => {
    let url: URL;
    try {
      url = new URL(rawOrigin);
    } catch {
      throw new Error(
        "GAME_SERVER_ALLOWED_WEB_ORIGINS entries must be absolute origins.",
      );
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new Error(
        "GAME_SERVER_ALLOWED_WEB_ORIGINS entries must be HTTP(S) origins without paths or credentials.",
      );
    }
    if (appEnvironment === "production" && url.protocol !== "https:") {
      throw new Error("Production Web origins must use HTTPS.");
    }
    if (
      appEnvironment !== "production" &&
      url.protocol === "http:" &&
      !isLoopbackHostname(url.hostname)
    ) {
      throw new Error("Insecure Web origins are limited to loopback hosts.");
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error(
      "GAME_SERVER_ALLOWED_WEB_ORIGINS cannot contain duplicates.",
    );
  }
  return Object.freeze(origins);
}

function reconnectGrace(environment: GameServerEnvironment): number {
  const value = Number(
    environment.GAME_SERVER_RECONNECT_GRACE_MILLISECONDS ?? "60000",
  );
  if (!Number.isSafeInteger(value) || value < 0 || value > 300_000) {
    throw new Error(
      "GAME_SERVER_RECONNECT_GRACE_MILLISECONDS must be an integer from 0 to 300000.",
    );
  }
  return value;
}

export function readGameServerConfig(
  environment: GameServerEnvironment,
): GameServerConfig {
  const appEnvironment = applicationEnvironment(environment);
  return {
    applicationEnvironment: appEnvironment,
    hostname: hostname(environment),
    port: port(environment, appEnvironment),
    ticketIssuer: required(environment, "GAME_SERVER_TICKET_ISSUER"),
    ticketSecret: required(environment, "GAME_SERVER_TICKET_SECRET"),
    allowedWebOrigins: allowedWebOrigins(environment, appEnvironment),
    reconnectGraceMilliseconds: reconnectGrace(environment),
  };
}
