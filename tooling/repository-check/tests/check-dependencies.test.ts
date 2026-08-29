import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkDependencies } from "../src/check-dependencies.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const violationFixtureRoot = fileURLToPath(
  new URL("../fixtures/violations/", import.meta.url),
);

test("the real repository satisfies dependency boundaries", async () => {
  const result = await checkDependencies(repositoryRoot);
  assert.deepEqual(result.violations, []);
});

test("fixtures prove every M1 dependency boundary fails closed", async () => {
  const result = await checkDependencies(violationFixtureRoot);
  const codes = new Set(result.violations.map((violation) => violation.code));
  const messages = result.violations
    .map((violation) => violation.message)
    .join("\n");

  assert.ok(codes.has("PLATFORM_TO_GAME_DEPENDENCY"));
  assert.ok(codes.has("CROSS_GAME_DEPENDENCY"));
  assert.ok(codes.has("CORE_FORBIDDEN_API"));
  assert.ok(codes.has("CORE_FORBIDDEN_IMPORT"));
  assert.ok(codes.has("INVALID_PACKAGE_EXPORT"));
  assert.ok(codes.has("UNEXPORTED_WORKSPACE_IMPORT"));
  assert.ok(codes.has("CYCLIC_DEPENDENCY"));

  for (const platformPackage of [
    "game-sdk",
    "protocol",
    "game-server-runtime",
  ]) {
    assert.match(messages, new RegExp(`@fixture/${platformPackage} must not`));
  }

  for (const forbiddenImport of [
    "react",
    "next/server",
    "colyseus",
    "drizzle-orm",
    "node:http",
    "ws",
  ]) {
    assert.match(messages, new RegExp(forbiddenImport.replace("/", "\\/")));
  }

  for (const forbiddenApi of [
    "Math.random()",
    "Date.now()",
    "performance.now()",
    "new Date()",
    "process.env",
  ]) {
    assert.match(messages, new RegExp(forbiddenApi.replace(/[().]/gu, "\\$&")));
  }

  assert.match(
    messages,
    /@fixture\/alpha must not import another game @fixture\/beta/u,
  );
  assert.match(messages, /@fixture\/game-sdk\/src\/private\.js/u);
});

test("framework and browser-test generated directories are not source", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "ogh-repository-check-"));
  try {
    const webRoot = join(fixtureRoot, "apps", "web");
    const gameRoot = join(fixtureRoot, "games", "tic");
    const generatedDirectories = [
      join(webRoot, ".next"),
      join(webRoot, "playwright-report"),
      join(webRoot, "test-results"),
    ];
    await Promise.all([
      mkdir(gameRoot, { recursive: true }),
      ...generatedDirectories.map((directory) =>
        mkdir(directory, { recursive: true }),
      ),
    ]);
    await Promise.all([
      writeFile(
        join(webRoot, "package.json"),
        JSON.stringify({ name: "@fixture/web", private: true }),
      ),
      writeFile(
        join(gameRoot, "package.json"),
        JSON.stringify({ name: "@fixture/tic", private: true }),
      ),
      ...generatedDirectories.map((directory) =>
        writeFile(join(directory, "generated.ts"), 'import "@fixture/tic";\n'),
      ),
    ]);

    const result = await checkDependencies(fixtureRoot);
    assert.deepEqual(result.violations, []);
    assert.equal(result.sourceFileCount, 0);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
