export interface RateLimitClock {
  nowMilliseconds(): number;
}

export interface AuthRateLimiterOptions {
  readonly limit: number;
  readonly windowMilliseconds: number;
  readonly maxEntries: number;
  readonly clock?: RateLimitClock;
}

interface Entry {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
}

const systemClock: RateLimitClock = {
  nowMilliseconds: () => Date.now(),
};

export class AuthRateLimiter {
  readonly #entries = new Map<string, Entry>();
  readonly #clock: RateLimitClock;

  public constructor(private readonly options: AuthRateLimiterOptions) {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit <= 0 ||
      !Number.isSafeInteger(options.windowMilliseconds) ||
      options.windowMilliseconds <= 0 ||
      !Number.isSafeInteger(options.maxEntries) ||
      options.maxEntries <= 0
    ) {
      throw new TypeError("RATE_LIMIT_CONFIGURATION_INVALID");
    }
    this.#clock = options.clock ?? systemClock;
  }

  public consume(key: string): boolean {
    const now = this.#clock.nowMilliseconds();
    if (!Number.isFinite(now) || key.length === 0 || key.length > 512) {
      return false;
    }
    const existing = this.#entries.get(key);
    if (
      existing === undefined ||
      now - existing.windowStartedAt >= this.options.windowMilliseconds
    ) {
      this.#makeSpace(now);
      this.#entries.set(key, {
        count: 1,
        windowStartedAt: now,
        lastSeenAt: now,
      });
      return true;
    }
    existing.lastSeenAt = now;
    existing.count += 1;
    return existing.count <= this.options.limit;
  }

  public get size(): number {
    return this.#entries.size;
  }

  #makeSpace(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (now - entry.windowStartedAt >= this.options.windowMilliseconds) {
        this.#entries.delete(key);
      }
    }
    if (this.#entries.size < this.options.maxEntries) return;
    const oldest = [...this.#entries.entries()].sort(
      (left, right) => left[1].lastSeenAt - right[1].lastSeenAt,
    )[0];
    if (oldest !== undefined) this.#entries.delete(oldest[0]);
  }
}

export const accountAuthRateLimiter = new AuthRateLimiter({
  limit: 10,
  windowMilliseconds: 10 * 60 * 1000,
  maxEntries: 4096,
});

export function authRateLimitKey(request: Request, operation: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0];
  const client =
    forwarded?.trim() || request.headers.get("x-real-ip") || "local";
  return `${operation}:${client.slice(0, 128)}`;
}
