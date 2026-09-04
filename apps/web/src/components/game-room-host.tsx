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

import {
  GameClientHost,
  createHttpTicketProvider,
} from "@online-game-hub/game-client-sdk";
import type {
  GameClientHostState,
  GameSetupProtocol,
  UnknownGameClientModule,
} from "@online-game-hub/game-client-sdk";
import type {
  CommandRejected,
  CommandRejectedV6,
  MatchStatus,
  RealtimeRejected,
  RoomConnected,
  RoomConnectedV6,
  RoomLifecycleState,
  RoomLifecycleStateV6,
  StarterChoice as ProtocolStarterChoice,
} from "@online-game-hub/protocol";
import {
  RealtimeGameClientHost,
  createRealtimeHttpTicketProvider,
} from "@online-game-hub/realtime-game-client-sdk";
import type {
  RealtimeGameClientHostState,
  UnknownRealtimeGameClientModule,
} from "@online-game-hub/realtime-game-client-sdk";
import {
  loadGameClientModule,
  loadRealtimeGameClientModule,
} from "@online-game-hub/game-registry/client";
import { gameCatalog } from "@online-game-hub/game-registry/catalog";
import { resolveCurrentGameDeployment } from "@online-game-hub/game-registry/deployment";

type StarterChoice = ProtocolStarterChoice;
type WebRoomConnected = RoomConnected | RoomConnectedV6;
type WebCommandRejected = CommandRejected | CommandRejectedV6;

export interface WebLifecyclePlayer {
  readonly slotId: string;
  readonly occupied: boolean;
  readonly online: boolean;
  readonly ready: boolean;
  readonly assignment: string | null;
}

export interface WebNextRoundLifecycle {
  readonly roundNumber: number;
  readonly starter: StarterChoice | null;
  readonly selfReady: boolean;
  readonly readyPlayerCount: number;
  readonly requiredPlayerCount: number;
  readonly assignmentOptions?: readonly string[] | undefined;
  readonly setupRevision?: number;
  readonly setupView?: unknown;
  readonly canReady?: boolean;
}

export interface WebRoomLifecycle {
  readonly type: "room.lifecycle";
  readonly protocolVersion: 5 | 6;
  readonly isOwner: boolean;
  readonly currentRound: RoomLifecycleState["currentRound"];
  readonly nextRound: WebNextRoundLifecycle | null;
  readonly closed: boolean;
  readonly closeReason: RoomLifecycleState["closeReason"];
  readonly players?: readonly WebLifecyclePlayer[] | undefined;
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
  readonly room: WebRoomConnected | null;
  readonly roomLifecycle: WebRoomLifecycle | null;
  readonly previousSnapshot: WebRoomSnapshot | null;
  readonly snapshot: WebRoomSnapshot | null;
  readonly rejection: WebCommandRejected | RealtimeRejected | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

type RuntimeKind = "turn-based" | "realtime";
type TurnBasedHost = GameClientHost<unknown, unknown>;
type RealtimeHost = RealtimeGameClientHost<unknown, unknown>;

function realtimeErrorMessage(code: string): string {
  const labels: Record<string, string> = {
    TICKET_ERROR: "无法取得连接票据。",
    ROOM_ERROR: "无法连接实时房间。",
    INVALID_SERVER_MESSAGE: "服务器返回了无效的实时消息。",
    CONNECTION_CLOSED: "实时连接已关闭。",
  };
  return labels[code] ?? "实时连接发生错误。";
}

function setupViewStarter(setupView: unknown): StarterChoice | null {
  if (
    setupView === null ||
    typeof setupView !== "object" ||
    !("starter" in setupView)
  ) {
    return null;
  }
  const starter = setupView.starter;
  return starter === "OWNER" || starter === "NON_OWNER" || starter === "RANDOM"
    ? starter
    : null;
}

export function normalizeRoomLifecycle(
  lifecycle: RoomLifecycleState | RoomLifecycleStateV6 | null,
): WebRoomLifecycle | null {
  if (lifecycle === null || lifecycle.protocolVersion === 5) return lifecycle;
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
            starter: setupViewStarter(nextRound.setupView),
            selfReady: nextRound.readiness.selfReady,
            readyPlayerCount: nextRound.readiness.readySlotIds.length,
            requiredPlayerCount: nextRound.readiness.requiredSlotIds.length,
            setupRevision: nextRound.setupRevision,
            setupView: nextRound.setupView,
            canReady: nextRound.readiness.canReady,
          },
    closed: lifecycle.closed,
    closeReason: lifecycle.closeReason,
    players: lifecycle.players.map((player) => ({
      ...player,
      assignment: null,
    })),
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
  readonly #unsubscribe: () => void;
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
        ticketProvider: createRealtimeHttpTicketProvider(),
        ...(options.setupProtocol === undefined
          ? {}
          : { setupProtocol: options.setupProtocol }),
      });
      this.#realtime = realtime;
      this.#state = this.#mapRealtimeState(realtime.getState());
      this.#unsubscribe = realtime.subscribe(() => {
        this.#state = this.#mapRealtimeState(realtime.getState());
        this.#notify();
      });
    } else {
      this.#realtime = null;
      const turnBased = new GameClientHost({
        gameServerUrl: options.gameServerUrl,
        ticketProvider: createHttpTicketProvider(),
        ...(options.setupProtocol === undefined
          ? {}
          : { setupProtocol: options.setupProtocol }),
      });
      this.#turnBased = turnBased;
      this.#state = this.#mapTurnBasedState(turnBased.getState());
      this.#unsubscribe = turnBased.subscribe(() => {
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

  public async joinRoom(gameId: string, roomCode: string): Promise<void> {
    const realtime = this.#realtime;
    if (realtime !== null) return realtime.joinRoom(gameId, roomCode);
    return this.#requireTurnBased().joinRoom(gameId, roomCode);
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

  public selectStarter(starter: StarterChoice): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().selectStarter(starter)
      : realtime.selectStarter(starter);
  }

  public selectPlayerCount(playerCount: number): Promise<void> {
    const turnBased = this.#turnBased;
    return turnBased === null
      ? Promise.reject(new Error("Realtime rooms have two fixed players."))
      : turnBased.selectPlayerCount(playerCount);
  }

  public selectPlayerAssignment(assignment: string): Promise<void> {
    const turnBased = this.#turnBased;
    return turnBased === null
      ? Promise.reject(new Error("Realtime rooms do not use assignments."))
      : turnBased.selectPlayerAssignment(assignment);
  }

  public clearPlayerAssignment(): Promise<void> {
    const turnBased = this.#turnBased;
    return turnBased === null
      ? Promise.reject(new Error("Realtime rooms do not use assignments."))
      : turnBased.clearPlayerAssignment();
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

  public startRematch(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().startRematch()
      : realtime.startRematch();
  }

  public closeRoom(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().closeRoom()
      : realtime.closeRoom();
  }

  public leaveRoom(): Promise<void> {
    const realtime = this.#realtime;
    return realtime === null
      ? this.#requireTurnBased().leaveRoom()
      : realtime.leaveRoom();
  }

  public close(): Promise<void> {
    this.#unsubscribe();
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
      error: state.error,
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
  readonly clientModule: UnknownGameClientModule | null;
  readonly realtimeClientModule: UnknownRealtimeGameClientModule | null;
  readonly setRoomCode: (value: string) => void;
  readonly createRoom: () => Promise<void>;
  readonly joinRoom: () => Promise<void>;
  readonly selectStarter: (starter: StarterChoice) => Promise<void>;
  readonly selectPlayerCount: (playerCount: number) => Promise<void>;
  readonly selectPlayerAssignment: (assignment: string) => Promise<void>;
  readonly clearPlayerAssignment: () => Promise<void>;
  readonly toggleRoundReady: () => Promise<void>;
  readonly startRematch: () => Promise<void>;
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
    resolveCurrentGameDeployment(gameId)?.setupProtocol ?? 5;
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
  const [clientModule, setClientModule] =
    useState<UnknownGameClientModule | null>(null);
  const [realtimeClientModule, setRealtimeClientModule] =
    useState<UnknownRealtimeGameClientModule | null>(null);
  const autoJoinKey = useRef<string | null>(null);
  const handledCloseReason = useRef<string | null>(null);
  const allowCompletedSetup = useRef(false);

  useEffect(() => () => void host.close(), [host]);

  useEffect(() => {
    if (state.room !== null || busy) return;
    const queryCode =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("roomCode");
    const targetCode = routeRoomCode(pathname, gameId) ?? queryCode;
    if (targetCode === null || targetCode.length === 0) return;
    const key = `${gameId}:${targetCode}`;
    if (autoJoinKey.current === key) return;
    autoJoinKey.current = key;
    setRoomCode(targetCode);
    setBusy(true);
    setLocalError(null);
    void host
      .joinRoom(gameId, targetCode)
      .catch(() => setLocalError("房间码无效或房间已关闭，请重试。"))
      .finally(() => setBusy(false));
  }, [busy, gameId, host, pathname, state.room]);

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
    const lifecycle = state.roomLifecycle;
    if (lifecycle === null || lifecycle.closed) return;
    if (lifecycle.currentRound?.status === "active") {
      allowCompletedSetup.current = false;
    }
    const shouldPlay =
      lifecycle.currentRound?.status === "active" ||
      (lifecycle.currentRound?.status === "completed" &&
        !allowCompletedSetup.current);
    const canonical = shouldPlay
      ? `/games/${encodeURIComponent(room.gameId)}/rooms/${encodeURIComponent(room.roomCode)}/play`
      : `/games/${encodeURIComponent(room.gameId)}/rooms/${encodeURIComponent(room.roomCode)}`;
    const currentCode = routeRoomCode(pathname, gameId);
    const currentIsPlay = routeIsPlay(pathname, gameId);
    if (currentCode !== room.roomCode || currentIsPlay !== shouldPlay) {
      router.replace(canonical, { scroll: false });
    }
  }, [gameId, pathname, router, state.room, state.roomLifecycle]);

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
    setLocalError("无法进入房间。房间可能已关闭，或房间码不正确。");
    router.replace(`/games/${encodeURIComponent(gameId)}`, { scroll: false });
  }, [gameId, pathname, router, state.error, state.room]);

  useEffect(() => {
    const snapshot = state.snapshot;
    if (snapshot === null) {
      setClientModule(null);
      setRealtimeClientModule(null);
      return;
    }
    let active = true;
    if (runtime === "realtime") {
      setClientModule(null);
      void loadRealtimeGameClientModule(
        snapshot.gameId,
        snapshot.gameVersion,
      ).then((module) => {
        if (active) setRealtimeClientModule(module ?? null);
      });
    } else {
      setRealtimeClientModule(null);
      void loadGameClientModule(snapshot.gameId, snapshot.gameVersion).then(
        (module) => {
          if (active) setClientModule(module ?? null);
        },
      );
    }
    return () => {
      active = false;
    };
  }, [runtime, state.snapshot?.gameId, state.snapshot?.gameVersion]);

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
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    handledCloseReason.current = null;
    try {
      await host.createRoom(gameId, initialConfig);
    } catch {
      setLocalError("无法创建房间，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }, [gameId, host, initialConfig]);

  const joinRoom = useCallback(async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    handledCloseReason.current = null;
    try {
      await host.joinRoom(gameId, roomCode);
    } catch {
      setLocalError("请输入有效的 8 位房间码。");
    } finally {
      setBusy(false);
    }
  }, [gameId, host, roomCode]);

  const selectStarter = useCallback(
    async (starter: StarterChoice): Promise<void> => {
      setBusy(true);
      setLocalError(null);
      try {
        await host.selectStarter(starter);
      } catch {
        setLocalError("无法更新下一局先手方。");
      } finally {
        setBusy(false);
      }
    },
    [host],
  );

  const selectPlayerCount = useCallback(
    async (playerCount: number): Promise<void> => {
      setBusy(true);
      setLocalError(null);
      try {
        await host.selectPlayerCount(playerCount);
      } catch {
        setLocalError("无法更新本轮人数。");
      } finally {
        setBusy(false);
      }
    },
    [host],
  );

  const selectPlayerAssignment = useCallback(
    async (assignment: string): Promise<void> => {
      setBusy(true);
      setLocalError(null);
      try {
        await host.selectPlayerAssignment(assignment);
      } catch {
        setLocalError("该营地不可用，请选择其他营地。");
      } finally {
        setBusy(false);
      }
    },
    [host],
  );

  const clearPlayerAssignment = useCallback(async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      await host.clearPlayerAssignment();
    } catch {
      setLocalError("无法取消营地选择。");
    } finally {
      setBusy(false);
    }
  }, [host]);

  const startRematch = useCallback(async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      await host.startRematch();
    } catch {
      setLocalError("无法立即重新对局，请确认双方均已在线。");
    } finally {
      setBusy(false);
    }
  }, [host]);

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
    if (state.roomLifecycle?.nextRound?.assignmentOptions !== undefined) {
      try {
        await host.clearPlayerAssignment();
      } catch {
        setLocalError("无法清空本轮营地选择。");
        return;
      }
    }
    allowCompletedSetup.current = true;
    router.push(
      `/games/${encodeURIComponent(currentRoom.gameId)}/rooms/${encodeURIComponent(currentRoom.roomCode)}`,
      { scroll: false },
    );
  }, [
    host,
    router,
    state.room,
    state.roomLifecycle?.nextRound?.assignmentOptions,
  ]);

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
      clientModule,
      realtimeClientModule,
      setRoomCode,
      createRoom,
      joinRoom,
      selectStarter,
      selectPlayerCount,
      selectPlayerAssignment,
      clearPlayerAssignment,
      toggleRoundReady,
      startRematch,
      copyInviteLink,
      selectInviteFallback,
      closeRoom,
      leaveRoom,
      openNextRoundSetup,
      clearLocalError: () => setLocalError(null),
    }),
    [
      busy,
      clientModule,
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
      selectStarter,
      startRematch,
      selectPlayerCount,
      selectPlayerAssignment,
      clearPlayerAssignment,
      state,
      toggleRoundReady,
      runtime,
      realtimeClientModule,
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
