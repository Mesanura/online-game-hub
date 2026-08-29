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
  loading: "准备连接",
  connecting: "正在连接",
  connected: "已连接",
  reconnecting: "正在重连",
  closed: "连接已关闭",
} as const;

const matchLabels = {
  waiting: "等待另一位玩家",
  active: "对局进行中",
  completed: "对局已完成",
  abandoned: "对局已终止",
} as const;

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
  const [busy, setBusy] = useState(false);
  const [clientModule, setClientModule] =
    useState<UnknownGameClientModule | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const autoJoinStarted = useRef(false);

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
  }, [router, state.room]);

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
    try {
      await host.joinRoom(props.gameId, roomCode);
    } catch {
      setLocalError("请输入有效的 8 位房间码。");
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

  return (
    <div className="page-shell game-page">
      <div>
        <p className="eyebrow">私人房间</p>
        <h1>{props.title}</h1>
        <p>
          浏览器只发送落子意图；回合、棋盘、胜负和 revision 全部由 Game Server
          裁定。
        </p>
      </div>

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
            <p>
              稳定席位：
              <strong data-testid="player-slot">
                {state.room.playerSlotId}
              </strong>
            </p>
          </>
        )}
        {state.snapshot === null ? null : (
          <p>
            比赛状态：
            <strong data-testid="match-status">
              {matchLabels[state.snapshot.status]}
            </strong>
          </p>
        )}
        {inviteUrl === null ? null : (
          <p>
            邀请链接：
            <a data-testid="invite-link" href={inviteUrl}>
              {inviteUrl}
            </a>
          </p>
        )}
      </section>

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
