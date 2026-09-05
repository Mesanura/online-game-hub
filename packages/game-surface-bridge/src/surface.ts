import {
  SURFACE_BRIDGE_VERSION,
  SURFACE_READY_TIMEOUT_MS,
  hostHandshakeSchema,
  hostSurfaceMessageMatchesBridgeVersion,
  hostSurfaceMessageSchema,
  surfaceHostMessageSchemaFor,
  type HostSurfaceMessage,
  type SurfaceBridgeVersion,
  type SurfaceHostMessage,
  type SurfaceMode,
} from "./protocol.js";

export interface SurfaceMessageEventTarget {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
}

export interface GameSurfaceBridgeOptions {
  readonly windowTarget?: SurfaceMessageEventTarget;
  readonly parentWindow?: Window;
  readonly bridgeVersion?: SurfaceBridgeVersion;
  readonly allowedHostOrigin: string;
  readonly readyTimeoutMs?: number;
  readonly onMessage: (message: HostSurfaceMessage) => void;
  readonly onProtocolError?: (error: Error) => void;
}

export class GameSurfaceBridge {
  readonly #options: GameSurfaceBridgeOptions;
  readonly #windowTarget: SurfaceMessageEventTarget;
  readonly #parentWindow: Window;
  readonly #bridgeVersion: SurfaceBridgeVersion;
  #port: MessagePort | null = null;
  #mode: SurfaceMode | null = null;
  #started = false;
  #disposed = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #intentIds = new Set<string>();

  constructor(options: GameSurfaceBridgeOptions) {
    this.#options = options;
    this.#windowTarget = options.windowTarget ?? window;
    this.#parentWindow = options.parentWindow ?? window.parent;
    this.#bridgeVersion = options.bridgeVersion ?? SURFACE_BRIDGE_VERSION;
  }

  get connected(): boolean {
    return this.#port !== null && !this.#disposed;
  }

  get mode(): SurfaceMode | null {
    return this.#mode;
  }

  start(): void {
    if (this.#disposed)
      throw new Error("A disposed Surface bridge cannot start.");
    if (this.#started) return;
    this.#started = true;
    this.#windowTarget.addEventListener("message", this.#handleWindowMessage);
    this.#timer = setTimeout(
      () => this.#protocolError(new Error("Surface handshake timed out.")),
      this.#options.readyTimeoutMs ?? SURFACE_READY_TIMEOUT_MS,
    );
  }

  send(message: SurfaceHostMessage): boolean {
    const parsed = surfaceHostMessageSchemaFor(this.#bridgeVersion).safeParse(
      message,
    );
    if (!parsed.success) {
      throw new TypeError("Invalid Surface-to-Host message.");
    }
    if (this.#port === null || this.#disposed) return false;
    if (
      parsed.data.type === "surface.intent" &&
      this.#intentIds.has(parsed.data.clientIntentId)
    ) {
      return false;
    }
    if (parsed.data.type === "surface.intent") {
      this.#intentIds.add(parsed.data.clientIntentId);
    }
    try {
      this.#port.postMessage(parsed.data);
      return true;
    } catch {
      this.#protocolError(new Error("Surface port failed to send a message."));
      return false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimer();
    this.#windowTarget.removeEventListener(
      "message",
      this.#handleWindowMessage,
    );
    if (this.#port !== null) {
      this.#port.onmessage = null;
      this.#port.onmessageerror = null;
      this.#port.close();
      this.#port = null;
    }
  }

  readonly #handleWindowMessage = (event: MessageEvent): void => {
    if (this.#port !== null || this.#disposed) return;
    if (event.source !== this.#parentWindow) return;
    if (
      this.#options.allowedHostOrigin !== "*" &&
      event.origin !== this.#options.allowedHostOrigin
    ) {
      return;
    }
    const hello = hostHandshakeSchema.safeParse(event.data);
    if (
      !hello.success ||
      hello.data.bridgeVersion !== this.#bridgeVersion ||
      event.ports.length !== 1
    ) {
      this.#protocolError(new Error("Invalid Surface handshake."));
      return;
    }
    const port = event.ports[0];
    if (port === undefined) {
      this.#protocolError(new Error("Surface handshake omitted its port."));
      return;
    }
    this.#clearTimer();
    this.#windowTarget.removeEventListener(
      "message",
      this.#handleWindowMessage,
    );
    this.#port = port;
    this.#mode = hello.data.mode;
    this.#port.onmessage = (portEvent) =>
      this.#handlePortMessage(portEvent.data);
    this.#port.onmessageerror = () =>
      this.#protocolError(
        new Error("Surface port received an invalid message."),
      );
    this.#port.start();
    try {
      this.#port.postMessage({
        type: "surface.ready",
        bridgeVersion: this.#bridgeVersion,
        nonce: hello.data.nonce,
      });
    } catch {
      this.#protocolError(new Error("Surface handshake response failed."));
    }
  };

  #handlePortMessage(input: unknown): void {
    if (this.#disposed) return;
    const parsed = hostSurfaceMessageSchema.safeParse(input);
    if (
      !parsed.success ||
      !hostSurfaceMessageMatchesBridgeVersion(parsed.data, this.#bridgeVersion)
    ) {
      this.#protocolError(new Error("Host sent an invalid Surface message."));
      return;
    }
    this.#options.onMessage(parsed.data);
    if (parsed.data.type === "host.dispose") this.dispose();
  }

  #protocolError(error: Error): void {
    this.#options.onProtocolError?.(error);
    this.dispose();
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
