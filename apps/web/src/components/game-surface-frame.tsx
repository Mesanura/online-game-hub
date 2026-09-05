"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  SurfaceBridgeHost,
  createSurfaceSandbox,
  type SurfaceBridgeHostStatus,
  type SurfaceResultSummaryV2,
} from "@online-game-hub/game-surface-bridge";
import type { ResolvedSurfaceEntrypoint } from "@online-game-hub/game-registry/deployment";

import type { WebRoomHostState } from "./game-room-host";

export interface SurfaceIntentResult {
  readonly status: "accepted" | "rejected" | "stale";
  readonly code?: string;
}

export interface GameSurfaceFrameHandle {
  requestResign(): Promise<SurfaceIntentResult>;
}

export interface GameSurfaceFrameProps {
  readonly entrypoint: ResolvedSurfaceEntrypoint;
  readonly locale: string;
  readonly reducedMotion: boolean;
  readonly connectionState: WebRoomHostState["connectionState"];
  readonly readOnly: boolean;
  readonly roundNumber: number | null;
  readonly revision?: number;
  readonly tick?: number;
  readonly setupRevision?: number;
  readonly payload: unknown;
  readonly outcome?: unknown | null;
  readonly onIntent: (intent: unknown) => Promise<SurfaceIntentResult>;
  readonly onDiagnostic?: (
    event: Readonly<{ name: string; value?: string | number | boolean }>,
  ) => void;
  readonly onResultSummary?: (summary: SurfaceResultSummaryV2 | null) => void;
}

function statusLabel(status: SurfaceBridgeHostStatus): string {
  if (status.state === "ready") return "游戏画面已就绪";
  if (status.state === "failed") return `游戏画面加载失败（${status.code}）`;
  if (status.state === "disposed") return "游戏画面已关闭";
  return "正在加载游戏画面…";
}

const SURFACE_COMMAND_TIMEOUT_MS = 10_000;

interface PendingSurfaceCommand {
  readonly resolve: (result: SurfaceIntentResult) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export const GameSurfaceFrame = forwardRef<
  GameSurfaceFrameHandle,
  GameSurfaceFrameProps
>(function GameSurfaceFrame(props, ref) {
  const [generation, setGeneration] = useState(0);
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SurfaceBridgeHostStatus>({
    state: "idle",
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<SurfaceBridgeHost | null>(null);
  const stateSequenceRef = useRef(0);
  const commandSequenceRef = useRef(0);
  const pendingIntentIdsRef = useRef(new Set<string>());
  const pendingCommandsRef = useRef(new Map<string, PendingSurfaceCommand>());
  const expiredCommandIdsRef = useRef(new Set<string>());
  const latestPropsRef = useRef(props);
  const frameKey = `${props.entrypoint.url}:${generation}`;
  latestPropsRef.current = props;

  const settlePendingCommand = useCallback(
    (clientIntentId: string, result: SurfaceIntentResult): void => {
      const pending = pendingCommandsRef.current.get(clientIntentId);
      if (pending === undefined) return;
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pendingCommandsRef.current.delete(clientIntentId);
      pending.resolve(result);
    },
    [],
  );

  const abortPendingCommands = useCallback((code: string): void => {
    for (const [clientIntentId, pending] of pendingCommandsRef.current) {
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pending.resolve({ status: "rejected", code });
      pendingCommandsRef.current.delete(clientIntentId);
    }
    pendingIntentIdsRef.current.clear();
    expiredCommandIdsRef.current.clear();
  }, []);

  const requestResign = useCallback((): Promise<SurfaceIntentResult> => {
    if (
      !latestPropsRef.current.entrypoint.platformControls.includes("RESIGN")
    ) {
      return Promise.resolve({
        status: "rejected",
        code: "SURFACE_COMMAND_NOT_SUPPORTED",
      });
    }
    if (
      pendingIntentIdsRef.current.size > 0 ||
      pendingCommandsRef.current.size > 0
    ) {
      return Promise.resolve({
        status: "rejected",
        code: "SURFACE_INTENT_IN_FLIGHT",
      });
    }
    const bridge = bridgeRef.current;
    if (bridge?.status.state !== "ready") {
      return Promise.resolve({
        status: "rejected",
        code: "SURFACE_NOT_READY",
      });
    }
    commandSequenceRef.current += 1;
    const clientIntentId = `platform-resign-${commandSequenceRef.current}`;
    return new Promise((resolve) => {
      const pending: PendingSurfaceCommand = {
        resolve,
        timeout: setTimeout(() => {
          pendingCommandsRef.current.delete(clientIntentId);
          expiredCommandIdsRef.current.add(clientIntentId);
          resolve({
            status: "rejected",
            code: "SURFACE_COMMAND_TIMEOUT",
          });
        }, SURFACE_COMMAND_TIMEOUT_MS),
      };
      pendingCommandsRef.current.set(clientIntentId, pending);
      if (
        !bridge.send({
          type: "host.command",
          clientIntentId,
          control: "RESIGN",
        })
      ) {
        settlePendingCommand(clientIntentId, {
          status: "rejected",
          code: "SURFACE_NOT_READY",
        });
      }
    });
  }, [settlePendingCommand]);

  useImperativeHandle(ref, () => ({ requestResign }), [requestResign]);

  useEffect(() => {
    let active = true;
    latestPropsRef.current.onResultSummary?.(null);
    stateSequenceRef.current = 0;
    pendingIntentIdsRef.current.clear();
    expiredCommandIdsRef.current.clear();
    const bridge = new SurfaceBridgeHost({
      bridgeVersion: props.entrypoint.artifact.bridgeVersion,
      frameWindow: () => iframeRef.current?.contentWindow ?? null,
      mode: props.entrypoint.mode,
      init: {
        gameId: props.entrypoint.gameId,
        gameVersion: props.entrypoint.gameVersion,
        locale: props.locale,
        reducedMotion: props.reducedMotion,
      },
      onIntent: (message) => {
        if (expiredCommandIdsRef.current.delete(message.clientIntentId)) {
          bridge.send({
            type: "host.intent-result",
            clientIntentId: message.clientIntentId,
            status: "rejected",
            code: "SURFACE_COMMAND_EXPIRED",
          });
          return;
        }
        pendingIntentIdsRef.current.add(message.clientIntentId);
        const pendingCommand = pendingCommandsRef.current.get(
          message.clientIntentId,
        );
        if (pendingCommand !== undefined && pendingCommand.timeout !== null) {
          clearTimeout(pendingCommand.timeout);
          pendingCommand.timeout = null;
        }
        void latestPropsRef.current
          .onIntent(message.intent)
          .then((result) => {
            pendingIntentIdsRef.current.delete(message.clientIntentId);
            if (!active || bridgeRef.current !== bridge) return;
            bridge.send({
              type: "host.intent-result",
              clientIntentId: message.clientIntentId,
              status: result.status,
              ...(result.code === undefined ? {} : { code: result.code }),
            });
            settlePendingCommand(message.clientIntentId, result);
          })
          .catch(() => {
            pendingIntentIdsRef.current.delete(message.clientIntentId);
            if (!active || bridgeRef.current !== bridge) return;
            const result = {
              status: "rejected",
              code: "HOST_INTENT_FAILED",
            } as const;
            bridge.send({
              type: "host.intent-result",
              clientIntentId: message.clientIntentId,
              ...result,
            });
            settlePendingCommand(message.clientIntentId, result);
          });
      },
      onSurfaceError: () => bridgeRef.current?.reportSurfaceCrash(),
      onDiagnostic: (message) => {
        latestPropsRef.current.onDiagnostic?.({
          name: message.name,
          ...(message.value === undefined ? {} : { value: message.value }),
        });
      },
      onResultSummary: (message) => {
        const latest = latestPropsRef.current;
        if (
          message.stateSequence !== stateSequenceRef.current ||
          latest.entrypoint.mode !== "play" ||
          !latest.readOnly ||
          latest.outcome === null ||
          latest.outcome === undefined
        ) {
          return;
        }
        latest.onResultSummary?.(message);
      },
      onStatusChange: (nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus.state === "failed" || nextStatus.state === "disposed") {
          latestPropsRef.current.onResultSummary?.(null);
          abortPendingCommands("SURFACE_COMMAND_ABORTED");
        }
      },
    });
    bridgeRef.current = bridge;
    setStatus({ state: "idle" });
    return () => {
      active = false;
      abortPendingCommands("SURFACE_COMMAND_ABORTED");
      bridge.dispose();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [
    generation,
    props.entrypoint.gameId,
    props.entrypoint.gameVersion,
    props.entrypoint.artifact.bridgeVersion,
    props.entrypoint.mode,
    props.entrypoint.url,
    props.locale,
    props.reducedMotion,
    abortPendingCommands,
    settlePendingCommand,
  ]);

  useEffect(() => {
    if (loadedFrameKey === frameKey) bridgeRef.current?.start();
  }, [frameKey, loadedFrameKey]);

  useEffect(() => {
    if (status.state !== "ready") return;
    const bridge = bridgeRef.current;
    if (bridge === null) return;
    stateSequenceRef.current += 1;
    try {
      bridge.send({
        type: "host.state",
        sequence: stateSequenceRef.current,
        connectionState: props.connectionState,
        readOnly: props.readOnly,
        roundNumber: props.roundNumber,
        ...(props.revision === undefined ? {} : { revision: props.revision }),
        ...(props.tick === undefined ? {} : { tick: props.tick }),
        ...(props.setupRevision === undefined
          ? {}
          : { setupRevision: props.setupRevision }),
        payload: props.payload,
        ...(props.outcome === undefined ? {} : { outcome: props.outcome }),
      });
    } catch {
      bridge.reportSurfaceCrash();
    }
  }, [
    props.connectionState,
    props.outcome,
    props.payload,
    props.readOnly,
    props.revision,
    props.roundNumber,
    props.setupRevision,
    props.tick,
    status.state,
  ]);

  useEffect(() => {
    if (status.state !== "ready") return;
    const root = rootRef.current;
    const bridge = bridgeRef.current;
    if (root === null || bridge === null) return;
    const stage = root.closest<HTMLElement>("[data-focus-mode]");
    const sendEnvironment = (): void => {
      const bounds = root.getBoundingClientRect();
      const fullscreenElement = document.fullscreenElement;
      const fullscreen =
        stage?.dataset.focusMode === "true" ||
        (fullscreenElement !== null && fullscreenElement.contains(root));
      try {
        bridge.send({
          type: "host.environment",
          width: bounds.width,
          height: bounds.height,
          fullscreen,
        });
      } catch {
        bridge.reportSurfaceCrash();
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(sendEnvironment);
    resizeObserver?.observe(root);
    const focusObserver =
      stage === null || typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => sendEnvironment());
    if (stage !== null) {
      focusObserver?.observe(stage, {
        attributeFilter: ["data-focus-mode"],
        attributes: true,
      });
    }
    document.addEventListener("fullscreenchange", sendEnvironment);
    sendEnvironment();
    return () => {
      resizeObserver?.disconnect();
      focusObserver?.disconnect();
      document.removeEventListener("fullscreenchange", sendEnvironment);
    };
  }, [status.state]);

  const failed = status.state === "failed";
  return (
    <div
      className="game-surface-frame"
      data-bridge-state={status.state}
      ref={rootRef}
    >
      <iframe
        className="game-surface-iframe"
        data-testid="game-surface-iframe"
        key={frameKey}
        onError={() => bridgeRef.current?.reportSurfaceCrash()}
        onLoad={() => setLoadedFrameKey(frameKey)}
        ref={iframeRef}
        referrerPolicy="no-referrer"
        sandbox={createSurfaceSandbox(
          props.entrypoint.artifact.capabilities.pointerLock === true,
        )}
        src={props.entrypoint.url}
        title={`${props.entrypoint.gameId} 游戏画面`}
      />
      {status.state === "ready" ? null : (
        <div
          className={`game-surface-status ${failed ? "is-failed" : ""}`}
          role={failed ? "alert" : "status"}
        >
          <p>{statusLabel(status)}</p>
          {failed ? (
            <button
              className="clay-button clay-button-primary"
              data-testid="retry-game-surface"
              onClick={() => setGeneration((value) => value + 1)}
              type="button"
            >
              重新加载游戏画面
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
});
