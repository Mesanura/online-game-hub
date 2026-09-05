import {
  SURFACE_BRIDGE_VERSION,
  SURFACE_READY_TIMEOUT_MS,
  hostSurfaceMessageMatchesBridgeVersion,
  hostHandshakeSchema,
  hostSurfaceMessageSchema,
  surfaceHandshakeSchema,
  surfaceHostMessageSchemaFor,
  type HostSurfaceMessage,
  type SurfaceBridgeVersion,
  type SurfaceHostMessage,
  type SurfaceMode,
} from "./protocol.js";

export type SurfaceBridgeHostStatus =
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly attempt: number }
  | { readonly state: "ready"; readonly attempt: number }
  | {
      readonly state: "failed";
      readonly attempt: number;
      readonly code:
        | "FRAME_UNAVAILABLE"
        | "HANDSHAKE_TRANSFER_FAILED"
        | "HANDSHAKE_TIMEOUT"
        | "INVALID_MESSAGE"
        | "NONCE_MISMATCH"
        | "SURFACE_CRASH";
    }
  | { readonly state: "disposed" };

export interface SurfaceFrameWindow {
  postMessage(
    message: unknown,
    targetOrigin: string,
    transfer?: Transferable[],
  ): void;
}

export interface SurfaceBridgeHostOptions {
  readonly frameWindow: () => SurfaceFrameWindow | null;
  readonly bridgeVersion?: SurfaceBridgeVersion;
  readonly mode: SurfaceMode;
  readonly init: {
    readonly gameId: string;
    readonly gameVersion: string;
    readonly locale: string;
    readonly reducedMotion: boolean;
  };
  readonly targetOrigin?: string;
  readonly readyTimeoutMs?: number;
  readonly createChannel?: () => MessageChannel;
  readonly createNonce?: () => string;
  readonly onIntent: (
    message: Extract<SurfaceHostMessage, { readonly type: "surface.intent" }>,
  ) => void;
  readonly onSurfaceError?: (
    message: Extract<SurfaceHostMessage, { readonly type: "surface.error" }>,
  ) => void;
  readonly onDiagnostic?: (
    message: Extract<
      SurfaceHostMessage,
      { readonly type: "surface.diagnostic" }
    >,
  ) => void;
  readonly onResultSummary?: (
    message: Extract<
      SurfaceHostMessage,
      { readonly type: "surface.result-summary" }
    >,
  ) => void;
  readonly onStatusChange?: (status: SurfaceBridgeHostStatus) => void;
}

export function createSurfaceNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createSurfaceSandbox(pointerLock = false): string {
  return pointerLock ? "allow-scripts allow-pointer-lock" : "allow-scripts";
}

const HOST_OWNED_INTENT_KEYS = new Set(["expectedRevision", "roundNumber"]);

function containsHostOwnedIntentKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsHostOwnedIntentKey(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        HOST_OWNED_INTENT_KEYS.has(key) || containsHostOwnedIntentKey(child),
    );
  }
  return false;
}

export class SurfaceBridgeHost {
  readonly #options: SurfaceBridgeHostOptions;
  readonly #bridgeVersion: SurfaceBridgeVersion;
  #status: SurfaceBridgeHostStatus = { state: "idle" };
  #attempt = 0;
  #nonce: string | null = null;
  #port: MessagePort | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #intentIds = new Set<string>();

  constructor(options: SurfaceBridgeHostOptions) {
    this.#options = options;
    this.#bridgeVersion = options.bridgeVersion ?? SURFACE_BRIDGE_VERSION;
  }

  get status(): SurfaceBridgeHostStatus {
    return this.#status;
  }

  start(): void {
    if (this.#status.state === "disposed") {
      throw new Error("A disposed Surface host cannot be started.");
    }
    if (this.#status.state === "loading" || this.#status.state === "ready") {
      return;
    }
    this.#resetAttempt();
    this.#attempt += 1;
    const frameWindow = this.#options.frameWindow();
    if (frameWindow === null) {
      this.#fail("FRAME_UNAVAILABLE");
      return;
    }
    const nonce = (this.#options.createNonce ?? createSurfaceNonce)();
    const channel = (
      this.#options.createChannel ?? (() => new MessageChannel())
    )();
    const handshake = hostHandshakeSchema.safeParse({
      type: "host.hello",
      bridgeVersion: this.#bridgeVersion,
      nonce,
      mode: this.#options.mode,
    });
    const init = hostSurfaceMessageSchema.safeParse({
      type: "host.init",
      bridgeVersion: SURFACE_BRIDGE_VERSION,
      mode: this.#options.mode,
      ...this.#options.init,
    });
    if (!handshake.success || !init.success) {
      channel.port1.close();
      channel.port2.close();
      this.#fail("INVALID_MESSAGE");
      return;
    }
    this.#nonce = nonce;
    this.#port = channel.port1;
    this.#port.onmessage = (event) => this.#handlePortMessage(event.data);
    this.#port.onmessageerror = () => this.#fail("INVALID_MESSAGE");
    this.#port.start();
    this.#setStatus({ state: "loading", attempt: this.#attempt });
    const readyTimeoutMs =
      this.#options.readyTimeoutMs ?? SURFACE_READY_TIMEOUT_MS;
    this.#timer = setTimeout(
      () => this.#fail("HANDSHAKE_TIMEOUT"),
      readyTimeoutMs,
    );
    try {
      frameWindow.postMessage(
        handshake.data,
        this.#options.targetOrigin ?? "*",
        [channel.port2],
      );
    } catch {
      channel.port2.close();
      this.#fail("HANDSHAKE_TRANSFER_FAILED");
    }
  }

  retry(): void {
    if (this.#status.state === "disposed") {
      throw new Error("A disposed Surface host cannot be retried.");
    }
    this.#resetAttempt();
    this.#setStatus({ state: "idle" });
    this.start();
  }

  send(message: HostSurfaceMessage): boolean {
    const parsed = hostSurfaceMessageSchema.safeParse(message);
    if (
      !parsed.success ||
      !hostSurfaceMessageMatchesBridgeVersion(parsed.data, this.#bridgeVersion)
    ) {
      throw new TypeError("Invalid Host-to-Surface message.");
    }
    if (this.#status.state !== "ready" || this.#port === null) return false;
    try {
      this.#port.postMessage(parsed.data);
      return true;
    } catch {
      this.#fail("SURFACE_CRASH");
      return false;
    }
  }

  reportSurfaceCrash(): void {
    if (this.#status.state === "loading" || this.#status.state === "ready") {
      this.#fail("SURFACE_CRASH");
    }
  }

  dispose(): void {
    if (this.#status.state === "disposed") return;
    if (this.#status.state === "ready") {
      this.send({ type: "host.dispose" });
    }
    this.#resetAttempt();
    this.#setStatus({ state: "disposed" });
  }

  #handlePortMessage(input: unknown): void {
    if (this.#status.state === "loading") {
      const ready = surfaceHandshakeSchema.safeParse(input);
      if (!ready.success) {
        this.#fail("INVALID_MESSAGE");
        return;
      }
      if (ready.data.nonce !== this.#nonce) {
        this.#fail("NONCE_MISMATCH");
        return;
      }
      if (ready.data.bridgeVersion !== this.#bridgeVersion) {
        this.#fail("INVALID_MESSAGE");
        return;
      }
      this.#clearTimer();
      const readyStatus = { state: "ready", attempt: this.#attempt } as const;
      this.#status = readyStatus;
      if (
        !this.send({
          type: "host.init",
          bridgeVersion: this.#bridgeVersion,
          mode: this.#options.mode,
          ...this.#options.init,
        })
      ) {
        if (this.#status.state === "ready") this.#fail("SURFACE_CRASH");
        return;
      }
      this.#options.onStatusChange?.(readyStatus);
      return;
    }
    if (this.#status.state !== "ready") return;
    const parsed = surfaceHostMessageSchemaFor(this.#bridgeVersion).safeParse(
      input,
    );
    if (!parsed.success) {
      this.#fail("INVALID_MESSAGE");
      return;
    }
    const message = parsed.data;
    if (
      message.type === "surface.intent" &&
      containsHostOwnedIntentKey(message.intent)
    ) {
      this.#fail("INVALID_MESSAGE");
      return;
    }
    if (message.type === "surface.intent") {
      if (this.#intentIds.has(message.clientIntentId)) {
        this.send({
          type: "host.intent-result",
          clientIntentId: message.clientIntentId,
          status: "rejected",
          code: "DUPLICATE_CLIENT_INTENT_ID",
        });
        return;
      }
      this.#intentIds.add(message.clientIntentId);
      this.#options.onIntent(message);
    } else if (message.type === "surface.error") {
      this.#options.onSurfaceError?.(message);
    } else if (message.type === "surface.diagnostic") {
      this.#options.onDiagnostic?.(message);
    } else {
      this.#options.onResultSummary?.(message);
    }
  }

  #fail(
    code: Extract<SurfaceBridgeHostStatus, { state: "failed" }>["code"],
  ): void {
    if (this.#status.state === "disposed" || this.#status.state === "failed") {
      return;
    }
    this.#resetAttempt();
    this.#setStatus({ state: "failed", attempt: this.#attempt, code });
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #resetAttempt(): void {
    this.#clearTimer();
    if (this.#port !== null) {
      this.#port.onmessage = null;
      this.#port.onmessageerror = null;
      this.#port.close();
    }
    this.#port = null;
    this.#nonce = null;
    this.#intentIds = new Set<string>();
  }

  #setStatus(status: SurfaceBridgeHostStatus): void {
    this.#status = status;
    this.#options.onStatusChange?.(status);
  }
}
