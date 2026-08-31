import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  transpilePackages: [
    "@online-game-hub/game-client-sdk",
    "@online-game-hub/game-registry",
    "@online-game-hub/protocol",
    "@online-game-hub/connect-four",
    "@online-game-hub/gomoku",
    "@online-game-hub/hex",
    "@online-game-hub/reversi",
    "@online-game-hub/tic-tac-toe",
    // create-game:transpile-package
  ],
};

export default nextConfig;
