import { z } from "zod";

export const DEFAULT_PLAYER_DISPLAY_NAME = "游客";
export const MAX_PLAYER_DISPLAY_NAME_GRAPHEMES = 24;
export const MAX_PLAYER_DISPLAY_NAME_INPUT_LENGTH = 512;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function normalizePlayerDisplayName(input: unknown): string | null {
  if (
    typeof input !== "string" ||
    input.length > MAX_PLAYER_DISPLAY_NAME_INPUT_LENGTH
  ) {
    return null;
  }
  const value = input.normalize("NFC").trim();
  if (value.length === 0 || /\p{Cc}/u.test(value)) return null;
  const length = Array.from(segmenter.segment(value)).length;
  return length <= MAX_PLAYER_DISPLAY_NAME_GRAPHEMES ? value : null;
}

/** Public room metadata is canonical plain text, never an account identifier. */
export const playerDisplayNameSchema = z
  .string()
  .refine((value) => normalizePlayerDisplayName(value) === value, {
    message: "Invalid player display name.",
  });
