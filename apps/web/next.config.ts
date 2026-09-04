import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/game-surfaces/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
          },
        ],
      },
    ];
  },
  transpilePackages: [
    "@online-game-hub/game-client-sdk",
    "@online-game-hub/game-registry",
    "@online-game-hub/game-surface-bridge",
    "@online-game-hub/protocol",
    "@online-game-hub/realtime-game-client-sdk",
    "@online-game-hub/connect-four",
    "@online-game-hub/chinese-checkers",
    "@online-game-hub/gomoku",
    "@online-game-hub/hex",
    "@online-game-hub/reversi",
    "@online-game-hub/pong",
    "@online-game-hub/tic-tac-toe",
    // create-game:transpile-package
  ],
};

export default nextConfig;
