ARG NODE_VERSION=24.14.0

FROM node:${NODE_VERSION}-bookworm-slim AS workspace-base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable \
  && corepack prepare pnpm@11.24.0 --activate

WORKDIR /workspace

FROM workspace-base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/game-server/package.json apps/game-server/package.json
COPY apps/web/package.json apps/web/package.json
COPY game-surfaces/workbench/package.json game-surfaces/workbench/package.json
COPY games/chinese-checkers/package.json games/chinese-checkers/package.json
COPY games/connect-four/package.json games/connect-four/package.json
COPY games/gomoku/package.json games/gomoku/package.json
COPY games/hex/package.json games/hex/package.json
COPY games/pong/package.json games/pong/package.json
COPY games/reversi/package.json games/reversi/package.json
COPY games/tic-tac-toe/package.json games/tic-tac-toe/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/game-client-sdk/package.json packages/game-client-sdk/package.json
COPY packages/game-registry/package.json packages/game-registry/package.json
COPY packages/game-sdk/package.json packages/game-sdk/package.json
COPY packages/game-server-runtime/package.json packages/game-server-runtime/package.json
COPY packages/game-server-ticket/package.json packages/game-server-ticket/package.json
COPY packages/game-setup/package.json packages/game-setup/package.json
COPY packages/game-surface-bridge/package.json packages/game-surface-bridge/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/realtime-game-client-sdk/package.json packages/realtime-game-client-sdk/package.json
COPY packages/realtime-game-sdk/package.json packages/realtime-game-sdk/package.json
COPY packages/realtime-game-server-runtime/package.json packages/realtime-game-server-runtime/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY tooling/e2e/package.json tooling/e2e/package.json
COPY tooling/repository-check/package.json tooling/repository-check/package.json
COPY tooling/surface-artifact/package.json tooling/surface-artifact/package.json
COPY tools/create-game/package.json tools/create-game/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build

ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

RUN pnpm exec turbo run build \
  --filter=@online-game-hub/game-server \
  --filter=@online-game-hub/web \
  --filter=@online-game-hub/surface-artifact \
  --filter='./game-surfaces/*'
RUN mkdir -p apps/web/public/game-surfaces \
  && node tooling/surface-artifact/src/cli.ts verify /workspace \
  && node tooling/surface-artifact/src/cli.ts publish /workspace /workspace/apps/web/public/game-surfaces
RUN pnpm --filter @online-game-hub/game-server deploy \
  --prod --legacy /deploy/game-server
RUN pnpm --filter @online-game-hub/database deploy \
  --prod --legacy /deploy/database

FROM node:${NODE_VERSION}-bookworm-slim AS database-migrator

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /deploy/database ./

USER node

CMD ["node", "dist/migrate-cli.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS game-server

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /deploy/game-server ./

USER node

CMD ["node", "dist/main.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./public

USER node

CMD ["node", "server.js"]
