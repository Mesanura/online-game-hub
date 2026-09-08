import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        play: root + "play/index.html",
        setup: root + "setup/index.html",
      },
    },
  },
  server: { cors: true, host: "127.0.0.1" },
});
