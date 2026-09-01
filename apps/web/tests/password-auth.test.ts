import { describe, expect, it } from "vitest";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  isValidPassword,
  normalizeUsername,
  verifyPassword,
} from "../src/server/password-auth.js";

describe("password authentication primitives", () => {
  it.each([
    ["Alice_123", "alice_123"],
    ["ABC", "abc"],
    ["a_b", "a_b"],
  ])("normalizes valid ASCII usernames", (input, expected) => {
    expect(normalizeUsername(input)).toBe(expected);
  });

  it.each([
    "ab",
    "a".repeat(25),
    "has-dash",
    "has space",
    "ümlaut",
    " leading",
    "trailing ",
    "",
  ])("rejects invalid username %j", (input) => {
    expect(normalizeUsername(input)).toBeNull();
  });

  it("accepts only the 12-128 character password length range", () => {
    expect(isValidPassword("x".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
    expect(isValidPassword("x".repeat(MAX_PASSWORD_LENGTH))).toBe(true);
    expect(isValidPassword("x".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isValidPassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).toBe(false);
  });

  it("hashes with parameterized Argon2id and verifies without storing plaintext", async () => {
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);
    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(
      verifyPassword(passwordHash, "wrong password value"),
    ).resolves.toBe(false);
  });

  it("fails closed for malformed or non-Argon2id hashes", async () => {
    await expect(
      verifyPassword("not-a-parameterized-hash", "correct password value"),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("$argon2id$broken", "correct password value"),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("x".repeat(1025), "correct password value"),
    ).resolves.toBe(false);
  });
});
