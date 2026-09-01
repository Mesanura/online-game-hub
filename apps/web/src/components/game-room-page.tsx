"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  Crown,
  GameController,
  House,
  Link as LinkIcon,
  LockKeyOpen,
  SignOut,
  Sparkle,
  ArrowsClockwise,
  Shuffle,
  Trophy,
  UserCircle,
  UserPlus,
  UsersThree,
  WarningCircle,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { GameClientHostState } from "@online-game-hub/game-client-sdk";

import {
  connectionLabels,
  useGameRoomHost,
  type InviteCopyState,
} from "./game-room-host";

export type GameRoomPageMode = "entry" | "room" | "play";

export const RESIGN_CONFIRMATION_MESSAGE =
  "确定要投降吗？投降后对手将立即获胜，且本局无法继续。";

interface GameRoomPageProps {
  readonly gameId: string;
  readonly title: string;
  readonly description: string;
  readonly mode: GameRoomPageMode;
}

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

function ConnectionBadge({
  state,
  testId,
}: {
  readonly state: GameClientHostState;
  readonly testId?: string;
}) {
  const label = connectionLabels[state.connectionState];
  const tone = state.connectionState === "connected" ? "online" : "quiet";
  return (
    <span className={`connection-badge connection-badge-${tone}`}>
      <WifiHigh size={16} weight="bold" aria-hidden="true" />
      <span data-testid={testId}>{label}</span>
    </span>
  );
}

export function InviteButton({
  inviteUrl,
  copyState,
  onCopy,
  onFallback,
}: {
  readonly inviteUrl: string | null;
  readonly copyState: InviteCopyState;
  readonly onCopy: () => void;
  readonly onFallback: () => void;
}) {
  const label =
    copyState === "copying"
      ? "复制中…"
      : copyState === "copied"
        ? "已复制"
        : "复制邀请链接";
  return (
    <div className="invite-control">
      {inviteUrl === null ? null : (
        <a
          aria-hidden="true"
          className="sr-only"
          data-testid="invite-link"
          href={inviteUrl}
          tabIndex={-1}
        >
          邀请链接
        </a>
      )}
      <button
        className={`clay-button invite-button ${copyState === "copied" ? "is-success" : ""}`}
        data-testid="copy-invite-link"
        disabled={inviteUrl === null || copyState === "copying"}
        onClick={onCopy}
        type="button"
      >
        {copyState === "copied" ? (
          <Check size={18} weight="bold" aria-hidden="true" />
        ) : (
          <Copy size={18} weight="bold" aria-hidden="true" />
        )}
        {label}
      </button>
      <p
        aria-atomic="true"
        aria-live="polite"
        className={`invite-status invite-status-${copyState}`}
        data-testid="copy-invite-status"
        role={copyState === "failed" ? "alert" : "status"}
      >
        {copyState === "copied"
          ? "邀请链接已复制。"
          : copyState === "failed"
            ? "复制失败，请选择下方链接手动复制。"
            : ""}
      </p>
      {copyState === "failed" && inviteUrl !== null ? (
        <div className="invite-fallback">
          <label htmlFor="invite-fallback">手动复制邀请链接</label>
          <div className="invite-fallback-row">
            <input
              data-testid="invite-fallback"
              id="invite-fallback"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={inviteUrl}
            />
            <button
              className="clay-button clay-button-secondary"
              onClick={onFallback}
              type="button"
            >
              选择链接
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageAlerts() {
  const { localError, localNotice, state } = useGameRoomHost();
  const rejection = rejectionLabel(state);
  return (
    <div className="page-alerts" aria-live="polite">
      {localNotice === null ? null : (
        <p className="notice-banner" data-testid="room-notice" role="status">
          <CheckCircle size={18} weight="bold" aria-hidden="true" />
          {localNotice}
        </p>
      )}
      {localError === null ? null : (
        <p className="error-banner" role="alert">
          <WarningCircle size={18} weight="bold" aria-hidden="true" />
          {localError}
        </p>
      )}
      {state.error === null ? null : (
        <p className="error-banner" data-testid="connection-error" role="alert">
          <WarningCircle size={18} weight="bold" aria-hidden="true" />
          {state.error.message}
        </p>
      )}
      {rejection === null ? null : (
        <p
          className="error-banner"
          data-testid="command-rejection"
          role="status"
        >
          <WarningCircle size={18} weight="bold" aria-hidden="true" />
          {rejection}
        </p>
      )}
    </div>
  );
}

function RoomToast() {
  const { playerCountNotice } = useGameRoomHost();
  if (playerCountNotice === null) return null;
  return (
    <p
      aria-atomic="true"
      aria-live="polite"
      className={`player-count-notice player-count-notice-${playerCountNotice}`}
      data-state={playerCountNotice}
      data-testid="player-count-notice"
      role="status"
    >
      {playerCountNotice === "ready"
        ? "玩家已到齐，游戏开始！"
        : "等待其他玩家加入…"}
    </p>
  );
}

function EntryView({
  title,
  description,
}: Pick<GameRoomPageProps, "title" | "description">) {
  const {
    busy,
    clearLocalError,
    createRoom,
    joinRoom,
    roomCode,
    setRoomCode,
    state,
  } = useGameRoomHost();
  return (
    <div className="page-shell console-page game-entry-page">
      <aside className="game-rail clay-surface">
        <Link aria-label="返回游戏目录" className="icon-button" href="/games">
          <ArrowLeft size={22} weight="bold" aria-hidden="true" />
        </Link>
        <div className="game-mark game-mark-large" aria-hidden="true">
          <GameController size={34} weight="duotone" />
        </div>
        <div className="game-rail-copy">
          <p className="eyebrow">私人房间</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="rail-current-item">
          <House size={18} weight="fill" aria-hidden="true" /> 房间
        </span>
        <span className="rail-footnote">
          <WifiHigh size={16} weight="bold" aria-hidden="true" /> 随时可用
        </span>
      </aside>
      <main className="entry-main-stage">
        <header className="stage-heading">
          <p className="eyebrow">{title}</p>
          <h1 id="room-entry-heading">创建或加入房间</h1>
          <p>与好友一起对弈，创建新房间或使用房间码加入。</p>
        </header>
        <section aria-labelledby="room-entry-heading" className="entry-actions">
          <div className="entry-action-bay entry-action-create clay-surface">
            <span className="action-bay-icon" aria-hidden="true">
              <UserPlus size={30} weight="bold" />
            </span>
            <div>
              <p className="eyebrow">开始一局</p>
              <h2>创建房间</h2>
              <p>创建新房间，邀请朋友对战。</p>
            </div>
            <button
              className="clay-button clay-button-primary clay-button-large"
              data-testid="create-room"
              disabled={busy || state.connectionState === "connecting"}
              onClick={() => {
                clearLocalError();
                void createRoom();
              }}
              type="button"
            >
              创建房间 <ArrowRight size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <div className="entry-action-bay entry-action-join clay-surface">
            <span
              className="action-bay-icon action-bay-icon-muted"
              aria-hidden="true"
            >
              <LinkIcon size={30} weight="bold" />
            </span>
            <div>
              <p className="eyebrow">已有邀请</p>
              <h2>加入房间</h2>
              <p>输入朋友分享的 8 位房间码。</p>
            </div>
            <form
              className="join-form"
              onSubmit={(event) => {
                event.preventDefault();
                void joinRoom();
              }}
            >
              <label htmlFor="room-code">房间码</label>
              <div className="recessed-input-wrap">
                <LockKeyOpen size={18} weight="bold" aria-hidden="true" />
                <input
                  autoComplete="off"
                  id="room-code"
                  maxLength={16}
                  onChange={(event) =>
                    setRoomCode(event.target.value.toUpperCase())
                  }
                  placeholder="例如 K7M4Q2"
                  value={roomCode}
                />
              </div>
              <button
                className="clay-button clay-button-secondary"
                data-testid="join-room"
                disabled={busy}
                type="submit"
              >
                加入房间{" "}
                <ArrowRight size={18} weight="bold" aria-hidden="true" />
              </button>
            </form>
          </div>
        </section>
      </main>
      <PageAlerts />
    </div>
  );
}

function PlayerPod({
  index,
  owner,
  self,
  ready,
  online,
  slotLabel,
}: {
  readonly index: number;
  readonly owner: boolean;
  readonly self: boolean;
  readonly ready: boolean;
  readonly online: boolean;
  readonly slotLabel: string;
}) {
  return (
    <article className={`player-pod ${self ? "player-pod-self" : ""}`}>
      <div className="player-avatar" aria-hidden="true">
        <UserCircle size={42} weight="duotone" />
      </div>
      <div className="player-pod-copy">
        <div className="player-name-row">
          <h3>玩家 {index}</h3>
          {owner ? (
            <span className="owner-badge">
              <Crown size={14} weight="fill" aria-hidden="true" /> 房主
            </span>
          ) : null}
        </div>
        <span className={`player-status ${online ? "is-online" : "is-away"}`}>
          <span className="status-dot" aria-hidden="true" />
          {online ? "在线" : "等待加入"}
        </span>
        <span
          className={`player-status ${ready ? "is-ready" : "is-not-ready"}`}
        >
          {ready ? (
            <CheckCircle size={16} weight="fill" aria-hidden="true" />
          ) : (
            <span className="status-ring" aria-hidden="true" />
          )}
          {ready ? "已准备" : "未准备"}
        </span>
        <span className="player-slot-label">稳定席位：{slotLabel}</span>
      </div>
    </article>
  );
}

function RoomView({ title }: Pick<GameRoomPageProps, "title">) {
  const {
    busy,
    closeRoom,
    copyInviteLink,
    inviteCopyState,
    inviteUrl,
    leaveRoom,
    selectInviteFallback,
    selectStarter,
    state,
    toggleRoundReady,
  } = useGameRoomHost();
  const lifecycle = state.roomLifecycle;
  const nextRound = lifecycle?.nextRound ?? null;
  const room = state.room;
  if (room === null || lifecycle === null || lifecycle.closed) {
    return <LoadingView label="正在连接房间…" />;
  }
  const roundNumber =
    nextRound?.roundNumber ?? lifecycle.currentRound?.roundNumber ?? 1;
  const selfReady = nextRound?.selfReady ?? false;
  const required = nextRound?.requiredPlayerCount ?? 2;
  const readyCount = nextRound?.readyPlayerCount ?? 0;
  const otherReady = readyCount === required || (readyCount > 0 && !selfReady);
  return (
    <div className="page-shell console-page room-page">
      <aside className="game-rail clay-surface">
        <Link aria-label="返回游戏目录" className="icon-button" href="/games">
          <ArrowLeft size={22} weight="bold" aria-hidden="true" />
        </Link>
        <div className="game-mark game-mark-large" aria-hidden="true">
          <GameController size={32} weight="duotone" />
        </div>
        <div className="game-rail-copy">
          <p className="eyebrow">等待房间</p>
          <h2>{title}</h2>
        </div>
        <div className="rail-meta">
          <span>房间码</span>
          <strong data-testid="room-code">{room.roomCode}</strong>
        </div>
        <div className="rail-meta">
          <span>当前局数</span>
          <strong data-testid="round-number">第 {roundNumber} 局</strong>
        </div>
        <InviteButton
          inviteUrl={inviteUrl}
          copyState={inviteCopyState}
          onCopy={() => void copyInviteLink()}
          onFallback={selectInviteFallback}
        />
        <ConnectionBadge state={state} testId="connection-state" />
      </aside>
      <main className="room-console">
        <header className="stage-heading">
          <p className="eyebrow">房间设置</p>
          <h1>准备下一局</h1>
          <p>确认先手与双方准备状态，全部就绪后自动进入对局。</p>
        </header>
        <section aria-labelledby="players-heading" className="player-bays">
          <div className="section-heading">
            <div>
              <p className="eyebrow">固定席位</p>
              <h2 id="players-heading">玩家准备</h2>
            </div>
            <ConnectionBadge state={state} />
          </div>
          <div className="player-pod-grid">
            <PlayerPod
              index={lifecycle.isOwner ? 1 : 2}
              owner={lifecycle.isOwner}
              ready={selfReady}
              self
              online={state.connectionState === "connected"}
              slotLabel={room.playerSlotId}
            />
            <PlayerPod
              index={lifecycle.isOwner ? 2 : 1}
              owner={!lifecycle.isOwner}
              ready={otherReady}
              self={false}
              online={otherReady}
              slotLabel={otherReady ? "已连接" : "等待分配"}
            />
          </div>
        </section>
        <section
          aria-labelledby="round-settings-heading"
          className="round-dock clay-surface"
        >
          <div className="round-dock-header">
            <div>
              <p className="eyebrow">第 {roundNumber} 局</p>
              <h2 id="round-settings-heading">房主选择先手</h2>
            </div>
            <span className="round-dock-note">
              <UsersThree size={18} weight="bold" aria-hidden="true" />
              {readyCount}/{required} 人已准备
            </span>
          </div>
          {lifecycle.isOwner && nextRound !== null ? (
            <div aria-label="选择先手方" className="starter-options">
              <button
                aria-pressed={nextRound.starter === "OWNER"}
                className="starter-choice"
                data-testid="starter-owner"
                disabled={busy}
                onClick={() => void selectStarter("OWNER")}
                type="button"
              >
                <span className="stone stone-black" aria-hidden="true" />
                我方先手
              </button>
              <button
                aria-pressed={nextRound.starter === "NON_OWNER"}
                className="starter-choice"
                data-testid="starter-non-owner"
                disabled={busy}
                onClick={() => void selectStarter("NON_OWNER")}
                type="button"
              >
                <span className="stone stone-white" aria-hidden="true" />
                对方先手
              </button>
              <button
                aria-pressed={nextRound.starter === "RANDOM"}
                className="starter-choice"
                data-testid="starter-random"
                disabled={busy}
                onClick={() => void selectStarter("RANDOM")}
                type="button"
              >
                <Shuffle size={20} weight="bold" aria-hidden="true" />
                随机先手
              </button>
            </div>
          ) : (
            <p className="waiting-copy">
              {nextRound?.starter === null
                ? "等待房主选择先手方。"
                : nextRound?.starter === "OWNER"
                  ? "房主选择由房主先手。"
                  : nextRound?.starter === "NON_OWNER"
                    ? "房主选择由另一位玩家先手。"
                    : "房主选择随机决定先手。"}
            </p>
          )}
          <div className="round-dock-actions">
            <p
              className="round-setup-status"
              data-testid="round-setup-status"
              role="status"
            >
              {nextRound?.starter === null
                ? "房主尚未选择先手方"
                : `${selfReady ? "你已准备；" : ""}${readyCount}/${required} 人已准备`}
            </p>
            <button
              className="clay-button clay-button-primary"
              data-testid="toggle-round-ready"
              disabled={busy || nextRound?.starter === null}
              onClick={() => void toggleRoundReady()}
              type="button"
            >
              {selfReady ? (
                <X size={19} weight="bold" aria-hidden="true" />
              ) : (
                <Check size={19} weight="bold" aria-hidden="true" />
              )}
              {selfReady ? "取消准备" : "准备开始"}
            </button>
          </div>
        </section>
        <div className="room-danger-row">
          {lifecycle.isOwner ? (
            <button
              className="clay-button clay-button-danger"
              data-testid="close-room"
              disabled={busy}
              onClick={() => void closeRoom()}
              type="button"
            >
              <X size={18} weight="bold" aria-hidden="true" /> 关闭房间
            </button>
          ) : (
            <button
              className="clay-button clay-button-danger"
              data-testid="leave-room"
              disabled={busy}
              onClick={() => void leaveRoom()}
              type="button"
            >
              <SignOut size={18} weight="bold" aria-hidden="true" /> 离开房间
            </button>
          )}
          <p className="room-help-copy">
            {nextRound?.starter === null
              ? "准备开始前，需要由房主选定先手。"
              : readyCount === required
                ? "玩家已到齐，正在进入对局…"
                : "等待另一位玩家完成准备。"}
          </p>
        </div>
      </main>
      <PageAlerts />
      <RoomToast />
      <span className="sr-only" data-testid="player-slot">
        {room.playerSlotId}
      </span>
      <span className="sr-only" data-testid="revision">
        {state.snapshot?.revision ?? 0}
      </span>
    </div>
  );
}

function scalarLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const labels: Record<string, string> = {
    BLACK: "黑方",
    WHITE: "白方",
    RED: "红方",
    YELLOW: "黄方",
    BLUE: "蓝方",
  };
  return labels[value] ?? value;
}

function viewSummary(view: unknown) {
  if (view === null || typeof view !== "object") {
    return { players: [], current: "等待同步", counts: [], result: null };
  }
  const record = view as Record<string, unknown>;
  const players = Array.isArray(record.players)
    ? record.players.map((player, index) => {
        const item = player as Record<string, unknown>;
        const marker = item.stone ?? item.disc ?? item.color ?? item.mark;
        return {
          index: index + 1,
          slotId: item.slotId,
          marker: scalarLabel(marker),
        };
      })
    : [];
  const board = Array.isArray(record.board) ? record.board : [];
  const counts = players.map((player) => ({
    ...player,
    count: board.filter((cell) => cell === player.slotId).length,
  }));
  const current =
    players.find((player) => player.slotId === record.nextTurnSlotId)?.marker ??
    "等待同步";
  const outcome = record.outcome;
  let result: string | null = null;
  if (outcome !== null && typeof outcome === "object") {
    const outcomeRecord = outcome as Record<string, unknown>;
    if (outcomeRecord.type === "DRAW") result = "平局";
    if (outcomeRecord.type === "WIN") {
      const winner = players.find(
        (player) => player.slotId === outcomeRecord.winnerSlotId,
      );
      result = winner === undefined ? "对局完成" : `玩家 ${winner.index} 胜利`;
    }
  }
  return { players, current, counts, result };
}

function LoadingView({ label }: { readonly label: string }) {
  return (
    <div className="page-shell loading-page">
      <div className="clay-spinner" aria-hidden="true" />
      <p>{label}</p>
      <PageAlerts />
    </div>
  );
}

function PlayView({ title }: Pick<GameRoomPageProps, "title">) {
  const [resignPending, setResignPending] = useState(false);
  const {
    busy,
    closeRoom,
    clientModule,
    host,
    leaveRoom,
    openNextRoundSetup,
    startRematch,
    state,
  } = useGameRoomHost();
  const snapshot = state.snapshot;
  const lifecycle = state.roomLifecycle;
  const room = state.room;
  const [viewError, parsedView] = useMemo(() => {
    if (snapshot === null || clientModule === null)
      return [false, null] as const;
    try {
      return [
        false,
        clientModule.parseView(snapshot.view) as Readonly<unknown>,
      ] as const;
    } catch {
      return [true, null] as const;
    }
  }, [clientModule, snapshot]);
  if (
    room === null ||
    lifecycle === null ||
    snapshot === null ||
    parsedView === null ||
    clientModule === null
  ) {
    return <LoadingView label="正在同步对局…" />;
  }
  const GameComponent = clientModule.Component;
  const summary = viewSummary(parsedView);
  const isCompleted = snapshot.status === "completed";
  const canResign =
    snapshot.status === "active" &&
    snapshot.viewer.kind === "player" &&
    clientModule.createResignAction !== undefined;
  const resign = async (): Promise<void> => {
    const createResignAction = clientModule.createResignAction;
    if (!canResign || createResignAction === undefined || resignPending) return;
    if (!window.confirm(RESIGN_CONFIRMATION_MESSAGE)) return;

    setResignPending(true);
    try {
      await host.submitAction(createResignAction());
    } catch {
      // The generic host renders transport and authoritative rejection state.
    } finally {
      setResignPending(false);
    }
  };
  return (
    <div className="page-shell console-page play-page">
      <aside className="game-rail play-rail clay-surface">
        <div className="game-mark game-mark-large" aria-hidden="true">
          <GameController size={32} weight="duotone" />
        </div>
        <div className="game-rail-copy">
          <p className="eyebrow">实际对局</p>
          <h1>{title}</h1>
          <span data-testid="round-number">第 {snapshot.roundNumber} 局</span>
        </div>
        <div className="rail-player-list">
          {summary.players.map((player) => (
            <div className="hud-player" key={player.index}>
              <span
                className={`stone stone-${player.index === 1 ? "black" : "white"}`}
                aria-hidden="true"
              />
              <span>玩家 {player.index}</span>
              <strong>{player.marker}</strong>
              <small>{summary.counts[player.index - 1]?.count ?? 0} 子</small>
            </div>
          ))}
        </div>
        <div className="turn-pill">
          <Sparkle size={17} weight="fill" aria-hidden="true" />
          <span>{isCompleted ? "对局已完成" : `当前：${summary.current}`}</span>
        </div>
        <ConnectionBadge state={state} testId="connection-state" />
        <div className="play-room-controls">
          <div className="rail-meta">
            <span>房间码</span>
            <strong data-testid="room-code">{room.roomCode}</strong>
          </div>
          {canResign ? (
            <button
              className="clay-button clay-button-resign"
              data-testid="resign-game"
              disabled={
                busy || resignPending || state.connectionState !== "connected"
              }
              onClick={() => void resign()}
              type="button"
            >
              <WarningCircle size={18} weight="bold" aria-hidden="true" />{" "}
              {resignPending ? "正在投降…" : "投降"}
            </button>
          ) : null}
          {lifecycle.isOwner ? (
            <button
              className="clay-button clay-button-danger"
              data-testid="close-room"
              disabled={busy || resignPending}
              onClick={() => void closeRoom()}
              type="button"
            >
              <X size={18} weight="bold" aria-hidden="true" /> 关闭房间
            </button>
          ) : (
            <button
              className="clay-button clay-button-danger"
              data-testid="leave-room"
              disabled={busy || resignPending}
              onClick={() => void leaveRoom()}
              type="button"
            >
              <SignOut size={18} weight="bold" aria-hidden="true" /> 离开房间
            </button>
          )}
        </div>
        <span className="sr-only" data-testid="player-slot">
          {room.playerSlotId}
        </span>
        <span className="sr-only" data-testid="revision">
          {snapshot.revision}
        </span>
        <span
          className="sr-only"
          data-status={snapshot.status}
          data-testid="match-status"
        >
          {snapshot.status === "completed" ? "对局已完成" : "对局进行中"}
        </span>
      </aside>
      <main className="play-stage-layout">
        <div className="game-stage" data-testid="game-stage">
          <GameComponent
            connectionState={state.connectionState}
            revision={snapshot.revision}
            submitAction={(action) => host.submitAction(action)}
            view={parsedView}
          />
        </div>
        {viewError ? (
          <p className="error-banner" role="alert">
            服务器返回的游戏视图无效。
          </p>
        ) : null}
        {isCompleted ? (
          <section
            aria-labelledby="result-heading"
            className="result-dock clay-surface"
          >
            <div className="result-icon" aria-hidden="true">
              <Trophy size={30} weight="fill" />
            </div>
            <div>
              <p className="eyebrow">本局结果</p>
              <h2 id="result-heading">{summary.result ?? "对局已完成"}</h2>
            </div>
            <div className="result-actions">
              <button
                className="clay-button clay-button-primary"
                data-testid="rematch-game"
                disabled={busy || state.connectionState !== "connected"}
                onClick={() => void startRematch()}
                type="button"
              >
                <ArrowsClockwise size={20} weight="bold" aria-hidden="true" />
                重新对局
              </button>
              <button
                className="clay-button clay-button-secondary"
                data-testid="next-round-settings"
                onClick={openNextRoundSetup}
                type="button"
              >
                设置规则
                <ArrowRight size={20} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : null}
      </main>
      <PageAlerts />
      <RoomToast />
    </div>
  );
}

export function GameRoomPage(props: GameRoomPageProps) {
  if (props.mode === "entry")
    return <EntryView title={props.title} description={props.description} />;
  if (props.mode === "room") return <RoomView title={props.title} />;
  return <PlayView title={props.title} />;
}
