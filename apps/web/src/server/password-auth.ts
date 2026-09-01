import argon2 from "argon2";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/u;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : null;
}

export function isValidPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (!isValidPassword(password)) {
    throw new TypeError("PASSWORD_INVALID");
  }
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (!isValidPassword(password) || passwordHash.length > 1024) return false;
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
