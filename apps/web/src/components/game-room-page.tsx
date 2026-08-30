"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  GameClientHost,
  createHttpTicketProvider,
} from "@online-game-hub/game-client-sdk";
import type {
  GameClientHostState,
  UnknownGameClientModule,
} from "@online-game-hub/game-client-sdk";
import { loadGameClientModule } from "@online-game-hub/game-registry/client";

interface GameRoomPageProps {
  readonly gameId: string;
  readonly title: string;
  readonly gameServerUrl: string;
  readonly initialConfig: unknown;
  readonly initialRoomCode?: string | undefined;
}

const connectionLabels = {
  idle: "尚未连接",
  loading: "准备连接",
  connecting: "正在连接",
  connected: "已连接",
  reconnecting: "正在重连",
  closed: "连接已关闭",
} as const;

const closeReasonLabels = {
  OWNER_CLOSED: "房主已关闭房间。",
  PLAYER_LEFT: "有玩家主动离开，本局已终止。",
  RECONNECT_TIMEOUT: "有玩家未在重连期限内返回，房间已关闭。",
  REMATCH_TIMEOUT: "终局后 5 分钟内未开始下一局，房间已关闭。",
} as const;

const matchLabels = {
  waiting: "等待另一位玩家",
  active: "对局进行中",
  completed: "对局已完成",
  abandoned: "对局已终止",
} as const;

type InviteCopyState = "idle" | "copying" | "copied" | "failed";

function rejectionLabel(state: GameClientHostState): string | null {
  const rejection = state.rejection;
  if (rejection === null) return null;
  if (rejection.code === "STALE_REVISION") {
    return "操作基于旧画面，已同步服务器的最新棋盘。";
  }
  if (rejection.code === "INVALID_ACTION_PAYLOAD") {
    return "操作格式无效，服务器未改变棋盘。";
  }
  if (rejection.code === "GAME_RULE_REJECTED") {
    const rules: Record<string, string> = {
      NOT_YOUR_TURN: "还没有轮到你。",
      CELL_OCCUPIED: "这个格子已经有棋子。",
      MATCH_ALREADY_FINISHED: "比赛已经结束。",
    };
    return rules[rejection.gameRuleCode ?? ""] ?? "服务器拒绝了这步操作。";
  }
  return `服务器拒绝了操作（${rejection.code}）。`;
}

export function GameRoomPage(props: GameRoomPageProps) {
  const router = useRouter();
  const host = useMemo(
    () =>
      new GameClientHost({
        gameServerUrl: props.gameServerUrl,
        ticketProvider: createHttpTicketProvider(),
      }),
    [props.gameServerUrl],
  );
  const subscribe = useCallback(
    (listener: () => void) => host.subscribe(listener),
    [host],
  );
  const getSnapshot = useCallback(() => host.getState(), [host]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [roomCode, setRoomCode] = useState(props.initialRoomCode ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientModule, setClientModule] =
    useState<UnknownGameClientModule | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopyState, setInviteCopyState] =
    useState<InviteCopyState>("idle");
  const autoJoinStarted = useRef(false);
  const handledCloseReason = useRef<string | null>(null);

  useEffect(() => () => void host.close(), [host]);

  useEffect(() => {
    if (
      props.initialRoomCode === undefined ||
      props.initialRoomCode.length === 0 ||
      autoJoinStarted.current
    ) {
      return;
    }
    autoJoinStarted.current = true;
    setBusy(true);
    void host
      .joinRoom(props.gameId, props.initialRoomCode)
      .catch(() => setLocalError("房间码格式无效。"))
      .finally(() => setBusy(false));
  }, [host, props.gameId, props.initialRoomCode]);

  useEffect(() => {
    if (state.room === null) return;
    const path = `/games/${encodeURIComponent(state.room.gameId)}?roomCode=${encodeURIComponent(state.room.roomCode)}`;
    router.replace(path, { scroll: false });
    setRoomCode(state.room.roomCode);
    setInviteUrl(`${window.location.origin}${path}`);
    setInviteCopyState("idle");
  }, [router, state.room]);

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
    router.replace(`/games/${encodeURIComponent(props.gameId)}`, {
      scroll: false,
    });
  }, [props.gameId, router, state.roomLifecycle]);

  useEffect(() => {
    const snapshot = state.snapshot;
    if (snapshot === null) return;
    let active = true;
    void loadGameClientModule(snapshot.gameId, snapshot.gameVersion).then(
      (module) => {
        if (active) setClientModule(module ?? null);
      },
    );
    return () => {
      active = false;
    };
  }, [state.snapshot?.gameId, state.snapshot?.gameVersion]);

  const createRoom = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    handledCloseReason.current = null;
    try {
      await host.createRoom(props.gameId, props.initialConfig);
    } catch {
      setLocalError("无法创建房间。");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    handledCloseReason.current = null;
    try {
      await host.joinRoom(props.gameId, roomCode);
    } catch {
      setLocalError("请输入有效的 8 位房间码。");
    } finally {
      setBusy(false);
    }
  };

  const toggleRematch = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      if (state.roomLifecycle?.rematch.selfReady === true) {
        await host.cancelRematch();
      } else {
        await host.requestRematch();
      }
    } catch {
      setLocalError("无法更新下一局准备状态。");
    } finally {
      setBusy(false);
    }
  };

  const copyInviteLink = async (): Promise<void> => {
    if (inviteUrl === null) return;
    setInviteCopyState("copying");
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopyState("copied");
    } catch {
      setInviteCopyState("failed");
    }
  };

  const closeRoom = async (): Promise<void> => {
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
  };

  const leaveRoom = async (): Promise<void> => {
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
      router.replace(`/games/${encodeURIComponent(props.gameId)}`, {
        scroll: false,
      });
    } catch {
      setLocalError("无法离开房间。");
    } finally {
      setBusy(false);
    }
  };

  let parsedView: Readonly<unknown> = {};
  let viewError = false;
  if (state.snapshot !== null && clientModule !== null) {
    try {
      parsedView = clientModule.parseView(
        state.snapshot.view,
      ) as Readonly<unknown>;
    } catch {
      viewError = true;
    }
  }
  const GameComponent = clientModule?.Component;
  const rejection = rejectionLabel(state);
  const lifecycle = state.roomLifecycle;
  const hasLiveRoom = state.room !== null;

  return (
    <div className="page-shell game-page">
      <div>
        <p className="eyebrow">私人房间</p>
        <h1>{props.title}</h1>
        <p>创建私人房间并邀请朋友，或输入房间码加入已有对局。</p>
      </div>

      {hasLiveRoom ? null : (
        <section aria-labelledby="room-entry" className="room-entry-panel">
          <h2 id="room-entry">创建或加入</h2>
          <button
            data-testid="create-room"
            disabled={busy || state.connectionState === "connecting"}
            onClick={() => void createRoom()}
            type="button"
          >
            创建新房间
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void joinRoom();
            }}
          >
            <label htmlFor="room-code">房间码</label>
            <input
              autoComplete="off"
              id="room-code"
              maxLength={16}
              onChange={(event) => setRoomCode(event.target.value)}
              placeholder="ABCD2345"
              value={roomCode}
            />
            <button data-testid="join-room" disabled={busy} type="submit">
              加入房间
            </button>
          </form>
        </section>
      )}

      <section aria-label="连接与房间状态" className="connection-panel">
        <p>
          连接：
          <strong data-testid="connection-state">
            {connectionLabels[state.connectionState]}
          </strong>
        </p>
        {state.room === null ? null : (
          <>
            <p>
              房间码：
              <strong data-testid="room-code">{state.room.roomCode}</strong>
            </p>
          </>
        )}
        {state.snapshot === null ? null : (
          <p>
            比赛状态：
            <strong
              aria-atomic="true"
              aria-live="polite"
              className="match-status"
              data-status={state.snapshot.status}
              data-testid="match-status"
              role="status"
            >
              {matchLabels[state.snapshot.status]}
            </strong>
          </p>
        )}
        {lifecycle === null || !hasLiveRoom ? null : (
          <p>
            当前轮次：
            <strong data-testid="round-number">
              第 {lifecycle.roundNumber} 局
            </strong>
          </p>
        )}
        {inviteUrl === null ? null : (
          <div className="invite-block">
            <p>邀请链接：</p>
            <div className="invite-link-row">
              <a data-testid="invite-link" href={inviteUrl}>
                {inviteUrl}
              </a>
              <button
                className="secondary-button copy-invite-button"
                data-testid="copy-invite-link"
                disabled={inviteCopyState === "copying"}
                onClick={() => void copyInviteLink()}
                type="button"
              >
                {inviteCopyState === "copying"
                  ? "复制中…"
                  : inviteCopyState === "copied"
                    ? "已复制"
                    : "复制链接"}
              </button>
            </div>
            {inviteCopyState === "copied" ? (
              <p
                className="copy-feedback copy-feedback-success"
                data-testid="copy-invite-status"
                role="status"
              >
                邀请链接已复制。
              </p>
            ) : null}
            {inviteCopyState === "failed" ? (
              <p
                className="copy-feedback copy-feedback-error"
                data-testid="copy-invite-status"
                role="alert"
              >
                复制失败，请手动选择链接复制。
              </p>
            ) : null}
          </div>
        )}
        {state.room === null ? null : (
          <details className="connection-details">
            <summary>连接详情</summary>
            <p>
              稳定席位：
              <strong data-testid="player-slot">
                {state.room.playerSlotId}
              </strong>
            </p>
            {state.snapshot === null ? null : (
              <p>
                同步版本：
                <strong data-testid="revision">
                  {state.snapshot.revision}
                </strong>
              </p>
            )}
          </details>
        )}
      </section>

      {state.snapshot === null || lifecycle === null || !hasLiveRoom ? null : (
        <section aria-label="房间操作" className="room-controls-panel">
          {state.snapshot.status === "completed" &&
          lifecycle.rematch.available ? (
            <>
              <button
                data-testid="toggle-rematch"
                disabled={busy}
                onClick={() => void toggleRematch()}
                type="button"
              >
                {lifecycle.rematch.selfReady ? "取消再来一局" : "再来一局"}
              </button>
              <p data-testid="rematch-status" role="status">
                {lifecycle.rematch.selfReady &&
                lifecycle.rematch.readyPlayerCount <
                  lifecycle.rematch.requiredPlayerCount
                  ? `已准备，等待其他玩家（${lifecycle.rematch.readyPlayerCount}/${lifecycle.rematch.requiredPlayerCount}）`
                  : `${lifecycle.rematch.readyPlayerCount}/${lifecycle.rematch.requiredPlayerCount} 人已准备`}
              </p>
            </>
          ) : null}
          {lifecycle.isOwner ? (
            <button
              className="danger-button"
              data-testid="close-room"
              disabled={busy}
              onClick={() => void closeRoom()}
              type="button"
            >
              关闭房间
            </button>
          ) : (
            <button
              className="secondary-button"
              data-testid="leave-room"
              disabled={busy}
              onClick={() => void leaveRoom()}
              type="button"
            >
              离开房间
            </button>
          )}
        </section>
      )}

      {localNotice === null ? null : (
        <p data-testid="room-notice" role="status">
          {localNotice}
        </p>
      )}
      {localError === null ? null : <p role="alert">{localError}</p>}
      {state.error === null ? null : (
        <p data-testid="connection-error" role="alert">
          {state.error.message}
        </p>
      )}
      {rejection === null ? null : (
        <p data-testid="command-rejection" role="status">
          {rejection}
        </p>
      )}
      {viewError ? <p role="alert">服务器返回的游戏视图无效。</p> : null}

      {state.snapshot !== null && GameComponent !== undefined && !viewError ? (
        <GameComponent
          connectionState={state.connectionState}
          revision={state.snapshot.revision}
          submitAction={(action) => host.submitAction(action)}
          view={parsedView}
        />
      ) : null}
    </div>
  );
}
