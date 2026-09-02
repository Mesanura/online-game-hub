export const DEFAULT_DISPLAY_NAME = "游客";
export const GUEST_PROFILE_STORAGE_KEY = "ogh_guest_profile_v1";
export const MAX_DISPLAY_NAME_GRAPHEMES = 24;
export const MAX_DISPLAY_NAME_INPUT_LENGTH = 512;

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const ASCII_LETTER_OR_DIGIT_PATTERN = /^[A-Za-z0-9]$/u;
const ASCII_DIGIT_PATTERN = /^[0-9]$/u;
const graphemeSegmenter = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

export function splitGraphemes(value: string): readonly string[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

export function normalizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.normalize("NFC").trim();
  if (value.length === 0 || CONTROL_CHARACTER_PATTERN.test(value)) return null;
  const graphemes = splitGraphemes(value);
  if (graphemes.length === 0 || graphemes.length > MAX_DISPLAY_NAME_GRAPHEMES) {
    return null;
  }
  return value;
}

export function getAvatarLabel(displayName: string): string {
  const graphemes = splitGraphemes(displayName);
  const first = graphemes[0];
  if (first === undefined) return DEFAULT_DISPLAY_NAME;
  if (!ASCII_LETTER_OR_DIGIT_PATTERN.test(first)) return first;

  const second = graphemes[1];
  if (second === undefined || !ASCII_LETTER_OR_DIGIT_PATTERN.test(second)) {
    return first.toUpperCase();
  }

  if (ASCII_DIGIT_PATTERN.test(first)) {
    // Numeric-leading names keep the first two digits in their uninterrupted ASCII prefix.
    const leadingAlphanumeric: string[] = [];
    for (const grapheme of graphemes) {
      if (!ASCII_LETTER_OR_DIGIT_PATTERN.test(grapheme)) break;
      leadingAlphanumeric.push(grapheme);
    }
    const leadingDigits = leadingAlphanumeric
      .filter((grapheme) => ASCII_DIGIT_PATTERN.test(grapheme))
      .slice(0, 2);
    if (leadingDigits.length === 2) return leadingDigits.join("");
  }

  return `${first}${second}`.toUpperCase();
}

export function readStoredGuestDisplayName(value: string | null): string {
  if (value === null) return DEFAULT_DISPLAY_NAME;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "displayName" in parsed
    ) {
      const displayName = normalizeDisplayName(
        (parsed as { displayName?: unknown }).displayName,
      );
      if (displayName !== null) return displayName;
    }
  } catch {
    return DEFAULT_DISPLAY_NAME;
  }
  return DEFAULT_DISPLAY_NAME;
}
