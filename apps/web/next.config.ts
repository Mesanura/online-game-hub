import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@online-game-hub/game-client-sdk",
    "@online-game-hub/game-registry",
    "@online-game-hub/protocol",
    "@online-game-hub/connect-four",
    "@online-game-hub/tic-tac-toe",
  ],
};

export default nextConfig;
