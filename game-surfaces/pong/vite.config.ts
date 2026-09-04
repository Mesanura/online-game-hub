import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        play: `${workspaceRoot}play/index.html`,
        replay: `${workspaceRoot}replay/index.html`,
        setup: `${workspaceRoot}setup/index.html`,
      },
    },
  },
  server: {
    cors: true,
    host: "127.0.0.1",
  },
});
