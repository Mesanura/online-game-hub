import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkMarkdownLinks } from "../src/check-markdown-links.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("the repository has no broken local Markdown links", async () => {
  assert.deepEqual(await checkMarkdownLinks(repositoryRoot), []);
});

test("a missing local Markdown target is rejected", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "online-game-hub-links-"),
  );
  try {
    await writeFile(
      path.join(fixtureRoot, "README.md"),
      "[missing](./missing.md)\n",
      "utf8",
    );
    const violations = await checkMarkdownLinks(fixtureRoot);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.target, "./missing.md");
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});
