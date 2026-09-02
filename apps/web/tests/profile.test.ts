import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISPLAY_NAME,
  MAX_DISPLAY_NAME_GRAPHEMES,
  getAvatarLabel,
  normalizeDisplayName,
  readStoredGuestDisplayName,
  splitGraphemes,
} from "../src/lib/profile.js";

describe("display name and avatar profile rules", () => {
  it.each([
    ["  你  ", "你"],
    ["Alice", "Alice"],
    ["e\u0301", "é"],
    ["👩‍💻", "👩‍💻"],
  ])("normalizes valid display name %j", (input, expected) => {
    expect(normalizeDisplayName(input)).toBe(expected);
  });

  it.each(["", "   ", "hello\u0000world", "hello\nworld", "a".repeat(25)])(
    "rejects invalid display name %j",
    (input) => {
      expect(normalizeDisplayName(input)).toBeNull();
    },
  );

  it("counts grapheme clusters instead of UTF-16 code units", () => {
    const value = "👩‍💻".repeat(MAX_DISPLAY_NAME_GRAPHEMES);
    expect(splitGraphemes(value)).toHaveLength(MAX_DISPLAY_NAME_GRAPHEMES);
    expect(normalizeDisplayName(value)).toBe(value);
    expect(normalizeDisplayName(`${value}👩‍💻`)).toBeNull();
  });

  it.each([
    ["你好", "你"],
    ["A你", "A"],
    ["👩‍💻player", "👩‍💻"],
    ["🇭🇰player", "🇭🇰"],
    ["👩‍💻玩家", "👩‍💻"],
    ["a1-player", "A1"],
    ["1a2b🐷你好", "12"],
    ["1你好2", "1"],
    ["🐷a", "🐷"],
    ["___", "_"],
  ])("derives avatar label from %j", (displayName, expected) => {
    expect(getAvatarLabel(displayName)).toBe(expected);
  });

  it("falls back to the default guest display name for invalid storage", () => {
    expect(readStoredGuestDisplayName(null)).toBe(DEFAULT_DISPLAY_NAME);
    expect(readStoredGuestDisplayName("invalid json")).toBe(
      DEFAULT_DISPLAY_NAME,
    );
    expect(
      readStoredGuestDisplayName(JSON.stringify({ displayName: "  你 " })),
    ).toBe("你");
    expect(
      readStoredGuestDisplayName(JSON.stringify({ displayName: "" })),
    ).toBe(DEFAULT_DISPLAY_NAME);
  });
});
