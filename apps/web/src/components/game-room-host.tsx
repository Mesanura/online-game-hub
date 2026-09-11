"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { GameClientHost } from "@online-game-hub/game-client-sdk";
import type {
  GameClientHostState,
  GameSetupProtocol,
} from "@online-game-hub/game-client-sdk";
import type {
  CommandRejectedV6,
  MatchStatus,
  RealtimeRejected,
  RoomConnectedV6,
  RoomDiscovery,
  RoomLifecycleStateV6,
} from "@online-game-hub/protocol";
import {
  SETUP_PROTOCOL_VERSION,
  roomDiscoverySchema,
} from "@online-game-hub/protocol";
import { RealtimeGameClientHost } from "@online-game-hub/realtime-game-client-sdk";
import type { RealtimeGameClientHostState } from "@online-game-hub/realtime-game-client-sdk";
import { gameCatalog } from "@online-game-hub/game-registry/catalog";
import { resolveCurrentGameDeployment } from "@online-game-hub/game-registry/deployment";
import { requestGameTicket } from "../lib/game-ticket";
import { PROFILE_UPDATED_EVENT } from "../lib/profile";

export const PROTOCOL_UPDATE_MESSAGE = "页面版本已过期，请刷新后重新连接。";

export interface WebLifecyclePlayer {
  readonly slotId: string;
  readonly displayName?: string | null | undefined;
  readonly occupied: boolean;
  readonly online: boolean;
  readonly ready: boolean;
}

export interface WebNextRoundLifecycle {
  readonly roundNumber: number;
  readonly selfReady: boolean;
  readonly readyPlayerCount: number;
  readonly requiredPlayerCount: number;
  readonly setupRevision: number;
  readonly setupView: unknown;
  readonly canReady: boolean;
}

export interface WebRoomLifecycle {
  readonly type: "room.lifecycle";
  readonly protocolVersion: 6;
  readonly isOwner: boolean;
  readonly currentRound: RoomLifecycleStateV6["currentRound"];
  readonly nextRound: WebNextRoundLifecycle | null;
  readonly closed: boolean;
  readonly closeReason: RoomLifecycleStateV6["closeReason"];
  readonly players: readonly WebLifecyclePlayer[];
  readonly causedByCommandId?: string | undefined;
}

export interface WebRoomSnapshot {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly roundNumber: number;
  readonly revision: number;
  readonly status: MatchStatus;
  readonly viewer: { readonly kind: "player"; readonly slotId: string };
  readonly view: unknown;
  readonly outcome: unknown | null;
  readonly causedByCommandId?: string;
  readonly tick?: number;
  readonly acknowledgedInputSequence?: number;
}

export interface WebRoomHostState {
  readonly connectionState: GameClientHostState["connectionState"];
  readonly room: RoomConnectedV6 | null;
  readonly roomLifecycle: WebRoomLifecycle | null;
  readonly previousSnapshot: WebRoomSnapshot | null;
  readonly snapshot: WebRoomSnapshot | null;
  readonly rejection: CommandRejectedV6 | RealtimeRejected | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

type RuntimeKind = "turn-based" | "realtime";
type TurnBasedHost = GameClientHost<unknown, unknown>;
type RealtimeHost = RealtimeGameClientHost<unknown, unknown>;

function realtimeErrorMessage(code: string): string {
  const labels: Record<string, string> = {
    PROTOCOL_VERSION_UNSUPPORTED: PROTOCOL_UPDATE_MESSAGE,
    TICKET_ERROR: "无法取得连接票据。",
    ROOM_ERROR: "无法连接实时房间。",
    INVALID_SERVER_MESSAGE: "服务器返回了无效的实时消息。",
    CONNECTION_CLOSED: "实时连接已关闭。",
  };
  return labels[code] ?? "实时连接发生错误。";
}

export function normalizeRoomLifecycle(
  lifecycle: RoomLifecycleStateV6 | null,
): WebRoomLifecycle | null {
  if (lifecycle === null) return null;
  const nextRound = lifecycle.nextRound;
  return {
    type: lifecycle.type,
    protocolVersion: lifecycle.protocolVersion,
    isOwner: lifecycle.isOwner,
    currentRound: lifecycle.currentRound,
    nextRound:
      nextRound === null
        ? null
        : {
            roundNumber: nextRound.roundNumber,
            selfReady: nextRound.readiness.selfReady,
            readyPlayerCount: nextRound.readiness.readySlotIds.length,
            requiredPlayerCount: nextRound.readiness.requiredSlotIds.length,
            setupRevision: nextRound.setupRevision,
            setupView: nextRound.setupView,
            canReady: nextRound.readiness.canReady,
          },
    closed: lifecycle.closed,
    closeReason: lifecycle.closeReason,
    players: lifecycle.players,
    ...(lifecycle.causedByCommandId === undefined
      ? {}
      : { causedByCommandId: lifecycle.causedByCommandId }),
  };
}

function mapRealtimeSnapshot(
  snapshot: RealtimeGameClientHostState["snapshot"],
  lifecycle: WebRoomLifecycle | null,
): WebRoomSnapshot | null {
  if (snapshot === null) return null;
  const lifecycleStatus = lifecycle?.currentRound?.status;
  const status: MatchStatus =
    lifecycleStatus === "abandoned"
      ? "abandoned"
      : snapshot.outcome !== null || lifecycleStatus === "completed"
        ? "completed"
        : "active";
  return {
    gameId: snapshot.gameId,
    gameVersion: snapshot.gameVersion,
    roundNumber: snapshot.roundNumber,
    revision: snapshot.tick,
    status,
    viewer: snapshot.viewer,
    view: snapshot.view,
    outcome: snapshot.outcome,
    tick: snapshot.tick,
    acknowledgedInputSequence: snapshot.acknowledgedInputSequence,
  };
}

/**
 * Composition-only adapter.  The two hosts remain independent packages and
 * protocols; this class only presents the Web room UI with one stable shape.
 */
export class RuntimeAwareHost {
  readonly runtime: RuntimeKind;
  readonly #turnBased: TurnBasedHost | null;
  readonly #realtime: RealtimeHost | null;
  readonly #listeners = new Set<() => void>();
  #state: WebRoomHostState;

  public constructor(options: {
    readonly runtime: RuntimeKind;
    readonly gameServerUrl: string;
    readonly setupProtocol?: GameSetupProtocol;
  }) {
    this.runtime = options.runtime;
    if (options.runtime === "realtime") {
      this.#turnBased = null;
      const realtime = new RealtimeGameClientHost({
        gameServerUrl: options.gameServerUrl,
        ticketProvider: requestGameTicket,
        ...(options.setupProtocol === undefined
          ? {}
          : { setupProtocol: options.setupProtocol }),
      });
      this.#realtime = realtime;
      this.#state = this.#mapRealtimeState(realtime.getState());
      realtime.subscribe(() => {
        this.#state = this.#mapRealtimeState(realtime.getState());
        this.#notify();
      });
    } else {
      this.#realtime = null;
      const turnBased = new GameClientHost({
        gameServerUrl: options.gameServerUrl,
        ticketProvider: requestGameTicket,
        ...(options.setupProtocol === undefined
          ? {}
          : { setupProtocol: options.setupProtocol }),
      });
      this.#turnBased = turnBased;
      this.#state = this.#mapTurnBasedState(turnBased.getState());
      turnBased.subscribe(() => {
        this.#state = this.#mapTurnBasedState(turnBased.getState());
        this.#notify();
      });
    }
  }

  public getState(): WebRoomHostState {
    return this.#state;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async createRoom(
    gameId: string,
    initialConfig: unknown,
  ): Promise<void> {
    const realtime = this.#realtime;
    if (realtime !== null) return realtime.createRoom(gameId, initialConfig);
    return this.#requireTurnBased().createRoom(gameId, initialConfig);
  }

  public async joinRoom(
    gameId: string,
    roomCode: string,
    setupProtocol?: GameSetupProtocol,
  ): Promise<void> {
    const realtime = this.#realtime;
    if (realtime !== null)
      return realtime.joinRoom(gameId, roomCode, setupProtocol);
    return this.#requireTurnBased().joinRoom(gameId, roomCode, setupProtocol);
  }

  public submitAction(action: unknown): Promise<void> {
    const turnBased = this.#turnBased;
    return turnBased === null
      ? Promise.reject(new Error("Realtime rooms accept input intents."))
      : turnBased.submitAction(action);
  }

  public submitInput(input: unknown): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? Promise.reject(new Error("Turn-based rooms accept actions."))
      : realtime.submitInput(input);
  }

  public submitSetup(action: unknown): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().submitSetup(action)
      : realtime.submitSetup(action);
  }

  public readyForRound(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().readyForRound()
      : realtime.readyForRound();
  }

  public cancelRoundReady(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().cancelRoundReady()
      : realtime.cancelRoundReady();
  }

  public closeRoom(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().closeRoom()
      : realtime.closeRoom();
  }

  public refreshProfile(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().refreshProfile()
      : realtime.refreshProfile();
  }

  public leaveRoom(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().leaveRoom()
      : realtime.leaveRoom();
  }

  public close(): Promise<void> {
    // React can reuse this adapter after effect cleanup. State forwarding has
    // the same lifetime as the adapter, rather than a single transport.
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().close()
      : realtime.close();
  }

  #requireTurnBased(): TurnBasedHost {
    if (this.#turnBased === null) {
      throw new Error("This realtime room has no turn-based host.");
    }
    return this.#turnBased;
  }

  #mapTurnBasedState(state: GameClientHostState): WebRoomHostState {
    const roomLifecycle = normalizeRoomLifecycle(state.roomLifecycle);
    return {
      connectionState: state.connectionState,
      room: state.room,
      roomLifecycle,
      previousSnapshot: null,
      snapshot:
        state.snapshot === null || state.snapshot.viewer.kind !== "player"
          ? null
          : {
              gameId: state.snapshot.gameId,
              gameVersion: state.snapshot.gameVersion,
              roundNumber: state.snapshot.roundNumber,
              revision: state.snapshot.revision,
              status: state.snapshot.status,
              viewer: state.snapshot.viewer,
              view: state.snapshot.view,
              outcome: state.snapshot.outcome,
              ...(state.snapshot.causedByCommandId === undefined
                ? {}
                : { causedByCommandId: state.snapshot.causedByCommandId }),
            },
      rejection: state.rejection,
      error:
        state.error?.code === "PROTOCOL_VERSION_UNSUPPORTED"
          ? { ...state.error, message: PROTOCOL_UPDATE_MESSAGE }
          : state.error,
    };
  }

  #mapRealtimeState(state: RealtimeGameClientHostState): WebRoomHostState {
    const rejection = state.rejection ?? state.controlRejection;
    const roomLifecycle = normalizeRoomLifecycle(state.roomLifecycle);
    return {
      connectionState: state.connectionState,
      room: state.room,
      roomLifecycle,
      previousSnapshot: mapRealtimeSnapshot(
        state.previousSnapshot,
        roomLifecycle,
      ),
      snapshot: mapRealtimeSnapshot(state.snapshot, roomLifecycle),
      rejection,
      error:
        state.error === null
          ? null
          : { code: state.error, message: realtimeErrorMessage(state.error) },
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const connectionLabels = {
  idle: "尚未连接",
  loading: "准备连接",
  connecting: "正在连接",
  connected: "已连接",
  reconnecting: "正在重连",
  closed: "连接已关闭",
} as const;

export const closeReasonLabels = {
  OWNER_CLOSED: "房主已关闭房间。",
  PLAYER_LEFT: "有玩家主动离开，本局已终止。",
  RECONNECT_TIMEOUT: "有玩家未在重连期限内返回，房间已关闭。",
  REMATCH_TIMEOUT: "终局后 5 分钟内未开始下一局，房间已关闭。",
} as const;

export type InviteCopyState = "idle" | "copying" | "copied" | "failed";
export type PlayerCountNotice = "waiting" | "ready";

interface GameRoomHostContextValue {
  readonly host: RuntimeAwareHost;
  readonly runtime: RuntimeKind;
  readonly state: WebRoomHostState;
  readonly busy: boolean;
  readonly roomCode: string;
  readonly localError: string | null;
  readonly localNotice: string | null;
  readonly inviteUrl: string | null;
  readonly inviteCopyState: InviteCopyState;
  readonly playerCountNotice: PlayerCountNotice | null;
  readonly setRoomCode: (value: string) => void;
  readonly createRoom: () => Promise<void>;
  readonly joinRoom: () => Promise<void>;
  readonly toggleRoundReady: () => Promise<void>;
  readonly copyInviteLink: () => Promise<void>;
  readonly selectInviteFallback: () => void;
  readonly closeRoom: () => Promise<void>;
  readonly leaveRoom: () => Promise<void>;
  readonly openNextRoundSetup: () => Promise<void>;
  readonly clearLocalError: () => void;
}

const GameRoomHostContext = createContext<GameRoomHostContextValue | null>(
  null,
);

function routeRoomCode(pathname: string, gameId: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const gameIndex = parts.indexOf("games");
  if (
    gameIndex === -1 ||
    parts[gameIndex + 1] !== gameId ||
    parts[gameIndex + 2] !== "rooms"
  ) {
    return null;
  }
  const code = parts[gameIndex + 3];
  return code === undefined || code.length === 0
    ? null
    : decodeURIComponent(code);
}

function routeIsPlay(pathname: string, gameId: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  const gameIndex = parts.indexOf("games");
  return (
    gameIndex !== -1 &&
    parts[gameIndex + 1] === gameId &&
    parts[gameIndex + 2] === "rooms" &&
    parts[gameIndex + 4] === "play"
  );
}

async function discoverRoom(
  gameId: string,
  roomCode: string,
): Promise<RoomDiscovery> {
  const query = new URLSearchParams({ gameId, roomCode });
  const response = await fetch(`/api/room-discovery?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const payload: unknown = await response.json();
  if (
    payload !== null &&
    typeof payload === "object" &&
    (("code" in payload && payload.code === "PROTOCOL_VERSION_UNSUPPORTED") ||
      ("setupProtocol" in payload && payload.setupProtocol === 5))
  ) {
    throw new Error("PROTOCOL_VERSION_UNSUPPORTED");
  }
  if (!response.ok) throw new Error("ROOM_DISCOVERY_FAILED");
  const parsed = roomDiscoverySchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.gameId !== gameId ||
    parsed.data.roomCode !== roomCode.trim().toUpperCase()
  ) {
    throw new Error("ROOM_DISCOVERY_FAILED");
  }
  return parsed.data;
}

export function GameRoomHostProvider({
  children,
  gameId,
  initialConfig,
  gameServerUrl,
}: {
  readonly children: ReactNode;
  readonly gameId: string;
  readonly initialConfig: unknown;
  readonly gameServerUrl: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const runtime: RuntimeKind =
    gameCatalog.find((candidate) => candidate.id === gameId)?.runtime ??
    "turn-based";
  const setupProtocol =
    resolveCurrentGameDeployment(gameId)?.setupProtocol ??
    SETUP_PROTOCOL_VERSION;
  const host = useMemo(
    () =>
      new RuntimeAwareHost({
        runtime,
        gameServerUrl,
        setupProtocol,
      }),
    [gameServerUrl, runtime, setupProtocol],
  );
  const subscribe = useCallback(
    (listener: () => void) => host.subscribe(listener),
    [host],
  );
  const getSnapshot = useCallback(() => host.getState(), [host]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [busy, setBusy] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopyState, setInviteCopyState] =
    useState<InviteCopyState>("idle");
  const [playerCountNotice, setPlayerCountNotice] =
    useState<PlayerCountNotice | null>(null);
  const autoJoinKey = useRef<string | null>(null);
  const handledCloseReason = useRef<string | null>(null);
  const allowCompletedSetup = useRef(false);
  const connectionAttempt = useRef(0);
  const previousPathname = useRef(pathname);
  // Entry is also the starting point of a new connection. Only a navigation
  // from a room back to entry should discard the existing connection.
  const returningToEntry =
    pathname === `/games/${encodeURIComponent(gameId)}` &&
    routeRoomCode(previousPathname.current, gameId) !== null;

  useEffect(
    () => () => {
      connectionAttempt.current += 1;
      autoJoinKey.current = null;
      void host.close();
    },
    [host],
  );

  useEffect(() => {
    let active = true;
    const refreshProfile = (): void => {
      const current = host.getState();
      if (
        current.connectionState !== "connected" ||
        current.roomLifecycle?.closed !== false
      )
        return;
      void host.refreshProfile().catch(() => {
        if (active && host.getState().room === current.room) {
          setLocalError("显示名已保存，但房间资料暂未同步，请稍后重试。");
        }
      });
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, refreshProfile);
    return () => {
      active = false;
      window.removeEventListener(PROFILE_UPDATED_EVENT, refreshProfile);
    };
  }, [host]);

  useEffect(() => {
    const previousPath = previousPathname.current;
    previousPathname.current = pathname;
    if (!returningToEntry) return;
    const previousState = host.getState();
    if (
      previousState.roomLifecycle?.currentRound?.status === "active" &&
      previousState.roomLifecycle.closed === false &&
      !window.confirm("离开会立即终止当前对局，确定继续吗？")
    ) {
      router.push(previousPath, { scroll: false });
      return;
    }
    const attempt = ++connectionAttempt.current;
    autoJoinKey.current = null;
    allowCompletedSetup.current = false;
    setBusy(true);
    setRoomCode("");
    setInviteUrl(null);
    setInviteCopyState("idle");
    // leaveRoom clears SDK errors. Keep the failed join's local message until
    // the player starts another create/join attempt from entry.
    if (previousState.room !== null || previousState.error === null) {
      setLocalError(null);
    }
    setPlayerCountNotice(null);
    if (previousState.room !== null) setLocalNotice("已离开房间。");
    void host.leaveRoom().finally(() => {
      if (connectionAttempt.current === attempt) setBusy(false);
    });
  }, [gameId, host, pathname, returningToEntry, router]);

  useEffect(() => {
    if (
      busy ||
      state.roomLifecycle?.closed === true ||
      (state.room !== null && state.connectionState !== "closed")
    ) {
      return;
    }
    const queryCode =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("roomCode");
    const targetCode = routeRoomCode(pathname, gameId) ?? queryCode;
    if (targetCode === null || targetCode.length === 0) return;
    const key = `${gameId}:${targetCode}`;
    if (autoJoinKey.current === key) return;
    const attempt = ++connectionAttempt.current;
    autoJoinKey.current = key;
    setRoomCode(targetCode);
    setBusy(true);
    setLocalError(null);
    void discoverRoom(gameId, targetCode)
      .then((discovery) => {
        if (connectionAttempt.current !== attempt) return;
        if (discovery.runtime !== runtime) {
          throw new Error("ROOM_RUNTIME_MISMATCH");
        }
        return host.joinRoom(gameId, targetCode, discovery.setupProtocol);
      })
      .catch((error: unknown) => {
        if (connectionAttempt.current === attempt)
          setLocalError(
            error instanceof Error &&
              error.message === "PROTOCOL_VERSION_UNSUPPORTED"
              ? PROTOCOL_UPDATE_MESSAGE
              : "房间码无效或房间已关闭，请重试。",
          );
      })
      .finally(() => {
        if (connectionAttempt.current === attempt) setBusy(false);
      });
  }, [
    busy,
    gameId,
    host,
    pathname,
    runtime,
    state.connectionState,
    state.room,
    state.roomLifecycle?.closed,
  ]);

  useEffect(() => {
    const room = state.room;
    if (room === null) return;
    setRoomCode(room.roomCode);
    if (typeof window !== "undefined") {
      setInviteUrl(
        `${window.location.origin}/games/${encodeURIComponent(room.gameId)}/rooms/${encodeURIComponent(room.roomCode)}`,
      );
    }
    setInviteCopyState("idle");
  }, [state.room]);

  const connectedGameId = state.room?.gameId;
  const connectedRoomCode = state.room?.roomCode;
  const roomClosed = state.roomLifecycle?.closed;
  const roundStatus = state.roomLifecycle?.currentRound?.status;

  useEffect(() => {
    if (
      returningToEntry ||
      connectedGameId === undefined ||
      connectedRoomCode === undefined ||
      roomClosed !== false
    ) {
      return;
    }
    if (roundStatus === "active") {
      allowCompletedSetup.current = false;
    }
    const shouldPlay =
      roundStatus === "active" ||
      (roundStatus === "completed" && !allowCompletedSetup.current);
    const roomPath = `/games/${encodeURIComponent(connectedGameId)}/rooms/${encodeURIComponent(connectedRoomCode)}`;
    const canonical = shouldPlay ? `${roomPath}/play` : roomPath;
    const currentCode = routeRoomCode(pathname, gameId);
    const currentIsPlay = routeIsPlay(pathname, gameId);
    if (currentCode === null) {
      router.push(canonical, { scroll: false });
    } else if (
      currentCode !== connectedRoomCode ||
      currentIsPlay !== shouldPlay
    ) {
      router.replace(canonical, { scroll: false });
    }
    // V6 lifecycle normalization creates an object for every realtime snapshot.
    // Only route facts may restart navigation; ticks must let it finish.
  }, [
    connectedGameId,
    connectedRoomCode,
    gameId,
    pathname,
    returningToEntry,
    roomClosed,
    roundStatus,
    router,
  ]);

  useEffect(() => {
    const lifecycle = state.roomLifecycle;
    if (
      lifecycle?.closed !== true ||
      lifecycle.closeReason === null ||
      handledCloseReason.current === lifecycle.closeReason
    ) {
      return;
    }
    handledCloseReason.current = lifecycle.closeReason;
    setInviteUrl(null);
    setInviteCopyState("idle");
    setRoomCode("");
    setLocalNotice(closeReasonLabels[lifecycle.closeReason]);
    router.replace(`/games/${encodeURIComponent(gameId)}`, { scroll: false });
  }, [gameId, router, state.roomLifecycle]);

  useEffect(() => {
    if (
      state.error === null ||
      state.room !== null ||
      routeRoomCode(pathname, gameId) === null
    ) {
      return;
    }
    setLocalError(
      state.error.code === "PROTOCOL_VERSION_UNSUPPORTED"
        ? PROTOCOL_UPDATE_MESSAGE
        : "无法进入房间。房间可能已关闭，或房间码不正确。",
    );
    router.replace(`/games/${encodeURIComponent(gameId)}`, { scroll: false });
  }, [gameId, pathname, router, state.error, state.room]);

  useEffect(() => {
    const status = state.roomLifecycle?.currentRound?.status ?? null;
    if (state.room === null) {
      setPlayerCountNotice(null);
      return;
    }
    if (status === null) {
      setPlayerCountNotice("waiting");
      return;
    }
    if (status !== "active") {
      setPlayerCountNotice(null);
      return;
    }
    setPlayerCountNotice("ready");
    const timeout = window.setTimeout(() => setPlayerCountNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [state.room, state.roomLifecycle?.currentRound?.status]);

  useEffect(() => {
    if (inviteCopyState !== "copied") return;
    const timeout = window.setTimeout(() => setInviteCopyState("idle"), 2_400);
    return () => window.clearTimeout(timeout);
  }, [inviteCopyState]);

  useEffect(() => {
    if (state.roomLifecycle?.currentRound?.status !== "active") return;
    const confirmActiveExit = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmActiveExit);
    return () => window.removeEventListener("beforeunload", confirmActiveExit);
  }, [state.roomLifecycle?.currentRound?.status]);

  const createRoom = useCallback(async (): Promise<void> => {
    const attempt = ++connectionAttempt.current;
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    handledCloseReason.current = null;
    allowCompletedSetup.current = false;
    try {
      await host.createRoom(gameId, initialConfig);
    } catch {
      if (connectionAttempt.current === attempt)
        setLocalError("无法创建房间，请稍后重试。");
    } finally {
      if (connectionAttempt.current === attempt) setBusy(false);
    }
  }, [gameId, host, initialConfig]);

  const joinRoom = useCallback(async (): Promise<void> => {
    const attempt = ++connectionAttempt.current;
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    handledCloseReason.current = null;
    allowCompletedSetup.current = false;
    try {
      const discovery = await discoverRoom(gameId, roomCode);
      if (connectionAttempt.current !== attempt) return;
      if (discovery.runtime !== runtime)
        throw new Error("ROOM_RUNTIME_MISMATCH");
      await host.joinRoom(gameId, roomCode, discovery.setupProtocol);
    } catch (error) {
      if (connectionAttempt.current === attempt)
        setLocalError(
          error instanceof Error &&
            error.message === "PROTOCOL_VERSION_UNSUPPORTED"
            ? PROTOCOL_UPDATE_MESSAGE
            : "房间码无效或房间已关闭，请重试。",
        );
    } finally {
      if (connectionAttempt.current === attempt) setBusy(false);
    }
  }, [gameId, host, roomCode, runtime]);

  const toggleRoundReady = useCallback(async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      if (state.roomLifecycle?.nextRound?.selfReady === true) {
        await host.cancelRoundReady();
      } else {
        await host.readyForRound();
      }
    } catch {
      setLocalError("无法更新准备状态。");
    } finally {
      setBusy(false);
    }
  }, [host, state.roomLifecycle?.nextRound?.selfReady]);

  const copyInviteLink = useCallback(async (): Promise<void> => {
    if (inviteUrl === null) return;
    setInviteCopyState("copying");
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopyState("copied");
    } catch {
      setInviteCopyState("failed");
    }
  }, [inviteUrl]);

  const selectInviteFallback = useCallback((): void => {
    const input = document.querySelector<HTMLInputElement>(
      "[data-testid='invite-fallback']",
    );
    input?.focus();
    input?.select();
  }, []);

  const closeRoom = useCallback(async (): Promise<void> => {
    if (
      state.snapshot?.status === "active" &&
      !window.confirm("关闭房间会立即终止当前对局，确定继续吗？")
    ) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await host.closeRoom();
    } catch {
      setLocalError("无法关闭房间。");
    } finally {
      setBusy(false);
    }
  }, [host, state.snapshot?.status]);

  const leaveRoom = useCallback(async (): Promise<void> => {
    if (
      state.snapshot?.status === "active" &&
      !window.confirm("离开会立即终止当前对局，确定继续吗？")
    ) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await host.leaveRoom();
      setInviteUrl(null);
      setInviteCopyState("idle");
      setRoomCode("");
      setLocalNotice("已离开房间。");
      router.replace(`/games/${encodeURIComponent(gameId)}`, {
        scroll: false,
      });
    } catch {
      setLocalError("无法离开房间。");
    } finally {
      setBusy(false);
    }
  }, [gameId, host, router, state.snapshot?.status]);

  const openNextRoundSetup = useCallback(async (): Promise<void> => {
    const currentRoom = state.room;
    if (currentRoom === null) return;
    allowCompletedSetup.current = true;
    router.push(
      `/games/${encodeURIComponent(currentRoom.gameId)}/rooms/${encodeURIComponent(currentRoom.roomCode)}`,
      { scroll: false },
    );
  }, [router, state.room]);

  const value = useMemo<GameRoomHostContextValue>(
    () => ({
      host,
      runtime,
      state,
      busy,
      roomCode,
      localError,
      localNotice,
      inviteUrl,
      inviteCopyState,
      playerCountNotice,
      setRoomCode,
      createRoom,
      joinRoom,
      toggleRoundReady,
      copyInviteLink,
      selectInviteFallback,
      closeRoom,
      leaveRoom,
      openNextRoundSetup,
      clearLocalError: () => setLocalError(null),
    }),
    [
      busy,
      closeRoom,
      copyInviteLink,
      createRoom,
      host,
      inviteCopyState,
      inviteUrl,
      joinRoom,
      leaveRoom,
      localError,
      localNotice,
      openNextRoundSetup,
      playerCountNotice,
      roomCode,
      selectInviteFallback,
      state,
      toggleRoundReady,
      runtime,
    ],
  );

  return (
    <GameRoomHostContext.Provider value={value}>
      {children}
    </GameRoomHostContext.Provider>
  );
}

export function useGameRoomHost(): GameRoomHostContextValue {
  const context = useContext(GameRoomHostContext);
  if (context === null) {
    throw new Error("useGameRoomHost must be used inside GameRoomHostProvider");
  }
  return context;
}
