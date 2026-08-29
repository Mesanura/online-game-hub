import assert from "node:assert/strict";
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

  assert.match(
    messages,
    /@fixture\/alpha must not import another game @fixture\/beta/u,
  );
  assert.match(messages, /@fixture\/game-sdk\/src\/private\.js/u);
});
