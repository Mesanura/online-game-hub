import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        setup: root + "setup/index.html",
        play: root + "play/index.html",
      },
    },
  },
  server: { cors: true, host: "127.0.0.1" },
});
