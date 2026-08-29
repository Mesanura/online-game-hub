import { createHmac, timingSafeEqual } from "node:crypto";

import {
  GAME_SERVER_TICKET_AUDIENCE,
  PROTOCOL_VERSION,
  gameServerTicketClaimsSchema,
} from "@online-game-hub/protocol";
import type { GameServerTicketClaims } from "@online-game-hub/protocol";

import { definePlayerSessionId } from "../auth.js";
import type { TicketVerificationResult, TicketVerifier } from "../auth.js";
import type { CancelTimer, RuntimeClock } from "../clock.js";
import type { RuntimeIdSource } from "../ids.js";
import { definePlayerSlotId } from "@online-game-hub/game-sdk";

export class FakeRuntimeClock implements RuntimeClock {
  #nowMilliseconds: number;
  #nextId = 1;
  readonly #timers = new Map<
    number,
    { readonly due: number; readonly callback: () => void }
  >();

  public constructor(nowMilliseconds = 0) {
    this.#nowMilliseconds = nowMilliseconds;
  }

  public nowMilliseconds(): number {
    return this.#nowMilliseconds;
  }

  public setTimeout(
    callback: () => void,
    delayMilliseconds: number,
  ): CancelTimer {
    if (!Number.isFinite(delayMilliseconds) || delayMilliseconds < 0) {
      throw new RangeError("Timer delay must be non-negative.");
    }
    const id = this.#nextId;
    this.#nextId += 1;
    this.#timers.set(id, {
      due: this.#nowMilliseconds + delayMilliseconds,
      callback,
    });
    return { cancel: () => this.#timers.delete(id) };
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("Clock advance must be non-negative.");
    }
    const target = this.#nowMilliseconds + milliseconds;
    for (;;) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort(
          (left, right) => left[1].due - right[1].due || left[0] - right[0],
        )[0];
      if (next === undefined) {
        break;
      }
      const [id, timer] = next;
      this.#timers.delete(id);
      this.#nowMilliseconds = timer.due;
      timer.callback();
    }
    this.#nowMilliseconds = target;
  }
}

export function createDeterministicRuntimeIdSource(
  roomCodes: readonly string[] = ["TEST2345"],
): RuntimeIdSource {
  let roomCodeIndex = 0;
  let replayIndex = 0;
  let seedIndex = 0;
  return {
    createRoomCode() {
      const roomCode = roomCodes[roomCodeIndex];
      roomCodeIndex += 1;
      if (roomCode === undefined) {
        throw new Error("Deterministic room codes exhausted.");
      }
      return roomCode;
    },
    createReplayId() {
      replayIndex += 1;
      return `test-replay-${replayIndex}`;
    },
    createRngSeed() {
      seedIndex += 1;
      return `test-seed-${seedIndex}`;
    },
    createPlayerSlotId(index) {
      return definePlayerSlotId(`slot-${index + 1}`);
    },
  };
}

interface UnsafelyIssuableClaims {
  readonly issuer: string;
  readonly audience: string;
  readonly playerSessionId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly ticketId: string;
  readonly protocolVersion: number;
}

export interface TestTicketAuthorityOptions {
  readonly issuer: string;
  readonly secret: string;
  readonly clock: RuntimeClock;
  readonly lifetimeSeconds?: number;
}

export interface TestTicketOverrides {
  readonly issuer?: string;
  readonly audience?: string;
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly ticketId?: string;
  readonly protocolVersion?: number;
}

export class TestTicketAuthority implements TicketVerifier {
  readonly #issuer: string;
  readonly #secret: string;
  readonly #clock: RuntimeClock;
  readonly #lifetimeSeconds: number;
  #ticketSequence = 0;

  public constructor(options: TestTicketAuthorityOptions) {
    if (options.issuer.length === 0 || options.secret.length < 16) {
      throw new TypeError(
        "Test ticket issuer and 16-character secret are required.",
      );
    }
    this.#issuer = options.issuer;
    this.#secret = options.secret;
    this.#clock = options.clock;
    this.#lifetimeSeconds = options.lifetimeSeconds ?? 30;
  }

  public issue(
    playerSessionId: string,
    overrides: TestTicketOverrides = {},
  ): string {
    const nowSeconds = Math.floor(this.#clock.nowMilliseconds() / 1000);
    this.#ticketSequence += 1;
    const claims: UnsafelyIssuableClaims = {
      issuer: overrides.issuer ?? this.#issuer,
      audience: overrides.audience ?? GAME_SERVER_TICKET_AUDIENCE,
      playerSessionId,
      issuedAt: overrides.issuedAt ?? nowSeconds,
      expiresAt: overrides.expiresAt ?? nowSeconds + this.#lifetimeSeconds,
      ticketId: overrides.ticketId ?? `test-ticket-${this.#ticketSequence}`,
      protocolVersion: overrides.protocolVersion ?? PROTOCOL_VERSION,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${this.#sign(payload)}`;
  }

  public async verify(ticket: unknown): Promise<TicketVerificationResult> {
    if (typeof ticket !== "string" || ticket.length === 0) {
      return this.#reject("MISSING_TICKET");
    }
    const [payload, suppliedSignature, extra] = ticket.split(".");
    if (
      payload === undefined ||
      suppliedSignature === undefined ||
      extra !== undefined ||
      !this.#signatureMatches(payload, suppliedSignature)
    ) {
      return this.#reject("INVALID_TICKET");
    }

    let rawClaims: unknown;
    try {
      rawClaims = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
    } catch {
      return this.#reject("INVALID_TICKET");
    }
    if (rawClaims === null || typeof rawClaims !== "object") {
      return this.#reject("INVALID_TICKET");
    }
    const candidate = rawClaims as Record<string, unknown>;
    if (candidate.protocolVersion !== PROTOCOL_VERSION) {
      return this.#reject("PROTOCOL_VERSION_UNSUPPORTED");
    }
    if (candidate.audience !== GAME_SERVER_TICKET_AUDIENCE) {
      return this.#reject("WRONG_AUDIENCE");
    }
    if (candidate.issuer !== this.#issuer) {
      return this.#reject("WRONG_ISSUER");
    }

    const parsed = gameServerTicketClaimsSchema.safeParse(candidate);
    if (!parsed.success) {
      return this.#reject("INVALID_TICKET");
    }
    const nowSeconds = Math.floor(this.#clock.nowMilliseconds() / 1000);
    if (parsed.data.expiresAt <= nowSeconds) {
      return this.#reject("EXPIRED_TICKET");
    }
    if (parsed.data.issuedAt > nowSeconds) {
      return this.#reject("INVALID_TICKET");
    }
    return {
      status: "verified",
      playerSessionId: definePlayerSessionId(parsed.data.playerSessionId),
      claims: parsed.data satisfies GameServerTicketClaims,
    };
  }

  #reject(
    code: Exclude<TicketVerificationResult, { status: "verified" }>["code"],
  ): TicketVerificationResult {
    return {
      status: "rejected",
      code,
      protocolCode:
        code === "PROTOCOL_VERSION_UNSUPPORTED"
          ? "PROTOCOL_VERSION_UNSUPPORTED"
          : "UNAUTHENTICATED",
    };
  }

  #sign(payload: string): string {
    return createHmac("sha256", this.#secret)
      .update(payload)
      .digest("base64url");
  }

  #signatureMatches(payload: string, suppliedSignature: string): boolean {
    const expected = Buffer.from(this.#sign(payload));
    const supplied = Buffer.from(suppliedSignature);
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  }
}
