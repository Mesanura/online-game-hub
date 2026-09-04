"use client";

import { useEffect, useRef, useState } from "react";

import {
  SurfaceBridgeHost,
  createSurfaceSandbox,
  type SurfaceBridgeHostStatus,
} from "@online-game-hub/game-surface-bridge";
import type { ResolvedSurfaceEntrypoint } from "@online-game-hub/game-registry/deployment";

import type { WebRoomHostState } from "./game-room-host";

export interface SurfaceIntentResult {
  readonly status: "accepted" | "rejected" | "stale";
  readonly code?: string;
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
}

function statusLabel(status: SurfaceBridgeHostStatus): string {
  if (status.state === "ready") return "游戏画面已就绪";
  if (status.state === "failed") return `游戏画面加载失败（${status.code}）`;
  if (status.state === "disposed") return "游戏画面已关闭";
  return "正在加载游戏画面…";
}

export function GameSurfaceFrame(props: GameSurfaceFrameProps) {
  const [generation, setGeneration] = useState(0);
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SurfaceBridgeHostStatus>({
    state: "idle",
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<SurfaceBridgeHost | null>(null);
  const stateSequenceRef = useRef(0);
  const latestPropsRef = useRef(props);
  const frameKey = `${props.entrypoint.url}:${generation}`;
  latestPropsRef.current = props;

  useEffect(() => {
    let active = true;
    stateSequenceRef.current = 0;
    const bridge = new SurfaceBridgeHost({
      frameWindow: () => iframeRef.current?.contentWindow ?? null,
      mode: props.entrypoint.mode,
      init: {
        gameId: props.entrypoint.gameId,
        gameVersion: props.entrypoint.gameVersion,
        locale: props.locale,
        reducedMotion: props.reducedMotion,
      },
      onIntent: (message) => {
        void latestPropsRef.current
          .onIntent(message.intent)
          .then((result) => {
            if (!active || bridgeRef.current !== bridge) return;
            bridge.send({
              type: "host.intent-result",
              clientIntentId: message.clientIntentId,
              status: result.status,
              ...(result.code === undefined ? {} : { code: result.code }),
            });
          })
          .catch(() => {
            if (!active || bridgeRef.current !== bridge) return;
            bridge.send({
              type: "host.intent-result",
              clientIntentId: message.clientIntentId,
              status: "rejected",
              code: "HOST_INTENT_FAILED",
            });
          });
      },
      onSurfaceError: () => bridgeRef.current?.reportSurfaceCrash(),
      onDiagnostic: (message) => {
        latestPropsRef.current.onDiagnostic?.({
          name: message.name,
          ...(message.value === undefined ? {} : { value: message.value }),
        });
      },
      onStatusChange: (nextStatus) => {
        if (active) setStatus(nextStatus);
      },
    });
    bridgeRef.current = bridge;
    setStatus({ state: "idle" });
    return () => {
      active = false;
      bridge.dispose();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [
    generation,
    props.entrypoint.gameId,
    props.entrypoint.gameVersion,
    props.entrypoint.mode,
    props.entrypoint.url,
    props.locale,
    props.reducedMotion,
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
}
