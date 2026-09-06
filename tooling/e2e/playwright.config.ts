import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["line"]],
  outputDir: "test-results",
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
});
