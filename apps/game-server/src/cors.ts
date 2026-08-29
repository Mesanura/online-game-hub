import { matchMaker } from "@colyseus/core";

const REJECTED_CORS_ORIGIN = "https://cors.invalid";

export function configureGameServerCors(
  allowedOrigins: readonly string[],
): () => void {
  if (allowedOrigins.length === 0) {
    throw new TypeError("At least one allowed Web origin is required.");
  }
  const origins = new Set(allowedOrigins);
  if (origins.size !== allowedOrigins.length) {
    throw new TypeError("Allowed Web origins must be unique.");
  }
  for (const origin of origins) {
    if (new URL(origin).origin !== origin) {
      throw new TypeError("Allowed Web origins must be canonical origins.");
    }
  }

  const previous = matchMaker.controller.getCorsHeaders;
  const configured = (headers: Headers): Record<string, string> => {
    const requestOrigin = headers.get("origin");
    return {
      "Access-Control-Allow-Origin":
        requestOrigin !== null && origins.has(requestOrigin)
          ? requestOrigin
          : REJECTED_CORS_ORIGIN,
      Vary: "Origin",
    };
  };
  matchMaker.controller.getCorsHeaders = configured;

  let active = true;
  return () => {
    if (active && matchMaker.controller.getCorsHeaders === configured) {
      matchMaker.controller.getCorsHeaders = previous;
    }
    active = false;
  };
}
