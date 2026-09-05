"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  CornersIn,
  CornersOut,
  Copy,
  Crown,
  GameController,
  House,
  Link as LinkIcon,
  List,
  LockKeyOpen,
  SignOut,
  ArrowsClockwise,
  Shuffle,
  UserCircle,
  UserPlus,
  UsersThree,
  WarningCircle,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { resolveGameSurfaceEntrypoint } from "@online-game-hub/game-registry/deployment";

import {
  connectionLabels,
  useGameRoomHost,
  type InviteCopyState,
  type WebRoomHostState,
} from "./game-room-host";
import {
  GameSurfaceFrame,
  type GameSurfaceFrameHandle,
} from "./game-surface-frame";

export type GameRoomPageMode = "entry" | "room" | "play";

export const RESIGN_CONFIRMATION_MESSAGE =
  "确定要投降吗？你将退出本局并在结果中排在未投降玩家之后。";

interface GameRoomPageProps {
  readonly gameId: string;
  readonly title: string;
  readonly description: string;
  readonly mode: GameRoomPageMode;
}

function rejectionLabel(state: WebRoomHostState): string | null {
  const rejection = state.rejection;
  if (rejection === null) return null;
  if (rejection.type === "realtime.rejected") {
    const realtimeRules: Record<string, string> = {
      NOT_A_PLAYER: "你不是该房间的玩家。",
      MATCH_NOT_ACTIVE: "比赛当前未进行。",
      ROUND_MISMATCH: "本轮已切换，请等待最新画面。",
      INVALID_INPUT_PAYLOAD: "输入格式无效。",
      STALE_INPUT_SEQUENCE: "输入已过期，正在同步服务器。",
      DUPLICATE_COMMAND: "重复输入已忽略。",
      RATE_LIMITED: "输入过于频繁，请稍后再试。",
    };
    return (
      realtimeRules[rejection.code] ?? `服务器拒绝了输入（${rejection.code}）。`
    );
  }
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
  readonly state: WebRoomHostState;
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
  assignment,
}: {
  readonly index: number;
  readonly owner: boolean;
  readonly self: boolean;
  readonly ready: boolean;
  readonly online: boolean;
  readonly slotLabel: string;
  readonly assignment?: string | null;
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
        {assignment === undefined ? null : (
          <span className="player-slot-label">
            营地：{assignment ?? "未选择"}
          </span>
        )}
      </div>
    </article>
  );
}

function RoomView({ title }: Pick<GameRoomPageProps, "title">) {
  const reducedMotion = useReducedMotionPreference();
  const locale =
    typeof navigator === "undefined" ? "zh-CN" : navigator.language || "zh-CN";
  const {
    busy,
    closeRoom,
    copyInviteLink,
    inviteCopyState,
    inviteUrl,
    host,
    leaveRoom,
    selectInviteFallback,
    selectStarter,
    selectPlayerCount,
    selectPlayerAssignment,
    clearPlayerAssignment,
    state,
    toggleRoundReady,
  } = useGameRoomHost();
  const lifecycle = state.roomLifecycle;
  const nextRound = lifecycle?.nextRound ?? null;
  const room = state.room;
  if (room === null || lifecycle === null || lifecycle.closed) {
    return <LoadingView label="正在连接房间…" />;
  }
  const setupSurfaceEntrypoint =
    lifecycle.protocolVersion === 6
      ? resolveGameSurfaceEntrypoint(room.gameId, room.gameVersion, "setup")
      : undefined;
  const roundNumber =
    nextRound?.roundNumber ?? lifecycle.currentRound?.roundNumber ?? 1;
  const selfReady = nextRound?.selfReady ?? false;
  const required = nextRound?.requiredPlayerCount ?? 2;
  const readyCount = nextRound?.readyPlayerCount ?? 0;
  const canReady =
    nextRound !== null && (nextRound.canReady ?? nextRound.starter !== null);
  const otherReady = readyCount === required || (readyCount > 0 && !selfReady);
  const lifecyclePlayers = lifecycle.players ?? [
    {
      slotId: room.playerSlotId,
      occupied: true,
      online: state.connectionState === "connected",
      ready: selfReady,
      assignment: null,
    },
    {
      slotId: "slot-2",
      occupied: otherReady,
      online: otherReady,
      ready: otherReady,
      assignment: null,
    },
  ];
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
          <p>完成本局游戏设置并确认准备，全部就绪后自动进入对局。</p>
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
            {lifecyclePlayers.map((player, index) => (
              <PlayerPod
                assignment={player.assignment}
                index={index + 1}
                key={player.slotId}
                owner={index === 0}
                ready={player.ready}
                self={player.slotId === room.playerSlotId}
                online={player.online}
                slotLabel={player.slotId}
              />
            ))}
          </div>
        </section>
        {setupSurfaceEntrypoint !== undefined ||
        nextRound?.assignmentOptions === undefined ? null : (
          <section
            aria-labelledby="assignment-heading"
            className="round-dock clay-surface assignment-dock"
          >
            <div className="round-dock-header">
              <div>
                <p className="eyebrow">营地选择</p>
                <h2 id="assignment-heading">选择你的六角营地</h2>
              </div>
              {lifecycle.isOwner ? (
                <label className="player-count-control">
                  <span>本轮人数</span>
                  <select
                    aria-label="本轮人数"
                    data-testid="player-count"
                    disabled={busy}
                    onChange={(event) =>
                      void selectPlayerCount(Number(event.target.value))
                    }
                    value={required}
                  >
                    {[2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {count} 人
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div aria-label="营地选项" className="assignment-options">
              {nextRound.assignmentOptions.map((assignment) => {
                const selected =
                  lifecyclePlayers.find(
                    (player) => player.slotId === room.playerSlotId,
                  )?.assignment === assignment;
                const occupied = lifecyclePlayers.some(
                  (player) =>
                    player.slotId !== room.playerSlotId &&
                    player.assignment === assignment,
                );
                return (
                  <button
                    aria-pressed={selected}
                    className="assignment-choice"
                    data-assignment={assignment}
                    disabled={busy || occupied}
                    key={assignment}
                    onClick={() =>
                      void (selected
                        ? clearPlayerAssignment()
                        : selectPlayerAssignment(assignment))
                    }
                    type="button"
                  >
                    {assignment}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        <section
          aria-labelledby="round-settings-heading"
          className="round-dock clay-surface"
        >
          <div className="round-dock-header">
            <div>
              <p className="eyebrow">第 {roundNumber} 局</p>
              <h2 id="round-settings-heading">
                {setupSurfaceEntrypoint === undefined
                  ? "房主选择先手"
                  : "游戏规则"}
              </h2>
            </div>
            <span className="round-dock-note">
              <UsersThree size={18} weight="bold" aria-hidden="true" />
              {readyCount}/{required} 人已准备
            </span>
          </div>
          {setupSurfaceEntrypoint !== undefined && nextRound !== null ? (
            <div
              className="round-setup-surface"
              data-testid="round-setup-surface"
            >
              <GameSurfaceFrame
                connectionState={state.connectionState}
                entrypoint={setupSurfaceEntrypoint}
                locale={locale}
                onIntent={async (intent) => {
                  try {
                    await host.submitSetup(intent);
                    return { status: "accepted" };
                  } catch {
                    return { status: "rejected", code: "HOST_REJECTED" };
                  }
                }}
                payload={nextRound.setupView}
                readOnly={false}
                reducedMotion={reducedMotion}
                roundNumber={nextRound.roundNumber}
                setupRevision={nextRound.setupRevision ?? 0}
              />
            </div>
          ) : lifecycle.isOwner && nextRound !== null ? (
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
              {!canReady
                ? setupSurfaceEntrypoint === undefined
                  ? "房主尚未选择先手方"
                  : "请先完成本局游戏设置"
                : `${selfReady ? "你已准备；" : ""}${readyCount}/${required} 人已准备`}
            </p>
            <button
              className="clay-button clay-button-primary"
              data-testid="toggle-round-ready"
              disabled={busy || !canReady}
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
            {!canReady
              ? setupSurfaceEntrypoint === undefined
                ? "准备开始前，需要由房主选定先手。"
                : "准备开始前，需要先完成本局游戏设置。"
              : readyCount === required
                ? "玩家已到齐，正在进入对局…"
                : `等待其余玩家完成准备（${readyCount}/${required}）。`}
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

function LoadingView({ label }: { readonly label: string }) {
  return (
    <div className="page-shell loading-page">
      <div className="clay-spinner" aria-hidden="true" />
      <p>{label}</p>
      <PageAlerts />
    </div>
  );
}

function SurfaceUnavailableView() {
  return (
    <div
      className="page-shell loading-page"
      data-testid="game-surface-unavailable"
    >
      <WarningCircle size={32} weight="duotone" aria-hidden="true" />
      <p>当前游戏版本没有可用的独立画面。</p>
      <PageAlerts />
    </div>
  );
}

function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

const PLAY_DRAWER_ID = "platform-play-drawer";
const PLAY_DRAWER_HEADING_ID = "platform-play-drawer-heading";
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface PlaySurfaceShellProps {
  readonly title: string;
  readonly modeLabel: string;
  readonly roomCode: string;
  readonly roundNumber: number;
  readonly playerSlotId: string;
  readonly revision: number;
  readonly completed: boolean;
  readonly owner: boolean;
  readonly busy: boolean;
  readonly resignPending: boolean;
  readonly canResign: boolean;
  readonly state: WebRoomHostState;
  readonly stage: ReactNode;
  readonly errorMessage: string | undefined;
  readonly statusProbes?: ReactNode;
  readonly overlays?: ReactNode;
  readonly onResign: () => void;
  readonly onCloseRoom: () => void;
  readonly onLeaveRoom: () => void;
  readonly onRematch: () => void;
  readonly onAdjustSettings: () => void;
}

export function PlaySurfaceShell({
  title,
  modeLabel,
  roomCode,
  roundNumber,
  playerSlotId,
  revision,
  completed,
  owner,
  busy,
  resignPending,
  canResign,
  state,
  stage,
  errorMessage,
  statusProbes,
  overlays,
  onResign,
  onCloseRoom,
  onLeaveRoom,
  onRematch,
  onAdjustSettings,
}: PlaySurfaceShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stageShellRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const closeDrawer = (): void => {
    setDrawerOpen(false);
    queueMicrotask(() => previousFocusRef.current?.focus());
  };

  const openDrawer = (): void => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (drawerOpen) drawerCloseRef.current?.focus();
  }, [drawerOpen]);

  useEffect(() => {
    const updateFullscreen = (): void => {
      setFullscreen(document.fullscreenElement === stageShellRef.current);
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && focusMode && !drawerOpen) {
        setFocusMode(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [drawerOpen, focusMode]);

  const handleDrawerKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.tabIndex >= 0);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toggleFullscreen = async (): Promise<void> => {
    if (focusMode) {
      setFocusMode(false);
      return;
    }
    if (document.fullscreenElement === stageShellRef.current) {
      try {
        await document.exitFullscreen();
      } finally {
        setFullscreen(false);
      }
      return;
    }
    const stageShell = stageShellRef.current;
    if (
      stageShell === null ||
      document.fullscreenEnabled === false ||
      typeof stageShell.requestFullscreen !== "function"
    ) {
      setFocusMode(true);
      return;
    }
    try {
      await stageShell.requestFullscreen();
      setFullscreen(true);
    } catch {
      setFocusMode(true);
    }
  };

  const expanded = fullscreen || focusMode;
  return (
    <div className="page-shell console-page play-page">
      <main
        className={`play-stage-layout ${focusMode ? "is-focus-mode" : ""}`}
        data-focus-mode={focusMode ? "true" : "false"}
        ref={stageShellRef}
      >
        <div className="play-toolbar clay-surface" aria-label="对局工具栏">
          <button
            aria-controls={PLAY_DRAWER_ID}
            aria-expanded={drawerOpen}
            aria-label="打开对局信息"
            className="play-toolbar-button"
            data-testid="toggle-game-hud"
            onClick={openDrawer}
            type="button"
          >
            <List size={21} weight="bold" aria-hidden="true" />
          </button>
          <ConnectionBadge state={state} testId="connection-state" />
          <button
            aria-label={expanded ? "退出全屏显示" : "全屏显示游戏"}
            aria-pressed={expanded}
            className="play-toolbar-button"
            data-testid="toggle-game-fullscreen"
            onClick={() => void toggleFullscreen()}
            type="button"
          >
            {expanded ? (
              <CornersIn size={21} weight="bold" aria-hidden="true" />
            ) : (
              <CornersOut size={21} weight="bold" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="game-stage" data-testid="game-stage">
          {stage}
        </div>
        {errorMessage === undefined ? null : (
          <p className="error-banner play-stage-error" role="alert">
            {errorMessage}
          </p>
        )}

        {drawerOpen ? (
          <div
            className="play-drawer-layer"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDrawer();
            }}
            role="presentation"
          >
            <aside
              aria-labelledby={PLAY_DRAWER_HEADING_ID}
              aria-modal="true"
              className="play-drawer clay-surface"
              id={PLAY_DRAWER_ID}
              onKeyDown={handleDrawerKeyDown}
              role="dialog"
            >
              <header className="play-drawer-header">
                <div>
                  <p className="eyebrow">{modeLabel}</p>
                  <h1 id={PLAY_DRAWER_HEADING_ID}>{title}</h1>
                </div>
                <button
                  aria-label="关闭对局信息"
                  className="play-toolbar-button"
                  data-testid="close-game-hud"
                  onClick={closeDrawer}
                  ref={drawerCloseRef}
                  type="button"
                >
                  <X size={21} weight="bold" aria-hidden="true" />
                </button>
              </header>
              <dl className="play-platform-meta">
                <div>
                  <dt>房间码</dt>
                  <dd>{roomCode}</dd>
                </div>
                <div>
                  <dt>局数</dt>
                  <dd>第 {roundNumber} 局</dd>
                </div>
                <div>
                  <dt>连接</dt>
                  <dd>
                    <ConnectionBadge state={state} />
                  </dd>
                </div>
                {completed ? (
                  <div>
                    <dt>状态</dt>
                    <dd>对局已完成</dd>
                  </div>
                ) : null}
              </dl>
              <div className="play-room-controls">
                {canResign ? (
                  <button
                    className="clay-button clay-button-resign"
                    data-testid="resign-game"
                    disabled={
                      busy ||
                      resignPending ||
                      state.connectionState !== "connected"
                    }
                    onClick={onResign}
                    type="button"
                  >
                    <WarningCircle size={18} weight="bold" aria-hidden="true" />
                    {resignPending ? "正在投降…" : "投降"}
                  </button>
                ) : null}
                {completed ? (
                  <>
                    <button
                      className="clay-button clay-button-primary"
                      data-testid="rematch-game"
                      disabled={busy || state.connectionState !== "connected"}
                      onClick={onRematch}
                      type="button"
                    >
                      <ArrowsClockwise
                        size={20}
                        weight="bold"
                        aria-hidden="true"
                      />
                      重新对局
                    </button>
                    <button
                      className="clay-button clay-button-secondary"
                      data-testid="next-round-settings"
                      onClick={onAdjustSettings}
                      type="button"
                    >
                      调整设置
                      <ArrowRight size={20} weight="bold" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
                {owner ? (
                  <button
                    className="clay-button clay-button-danger"
                    data-testid="close-room"
                    disabled={busy || resignPending}
                    onClick={onCloseRoom}
                    type="button"
                  >
                    <X size={18} weight="bold" aria-hidden="true" /> 关闭房间
                  </button>
                ) : (
                  <button
                    className="clay-button clay-button-danger"
                    data-testid="leave-room"
                    disabled={busy || resignPending}
                    onClick={onLeaveRoom}
                    type="button"
                  >
                    <SignOut size={18} weight="bold" aria-hidden="true" />
                    离开房间
                  </button>
                )}
              </div>
            </aside>
          </div>
        ) : null}

        <span className="sr-only" data-testid="room-code">
          {roomCode}
        </span>
        <span className="sr-only" data-testid="round-number">
          第 {roundNumber} 局
        </span>
        <span className="sr-only" data-testid="player-slot">
          {playerSlotId}
        </span>
        <span className="sr-only" data-testid="revision">
          {revision}
        </span>
        <span
          className="sr-only"
          data-status={completed ? "completed" : "active"}
          data-testid="match-status"
        >
          {completed ? "对局已完成" : "对局进行中"}
        </span>
        {statusProbes}
        {overlays}
      </main>
    </div>
  );
}

function TurnBasedPlayView({ title }: Pick<GameRoomPageProps, "title">) {
  const [resignPending, setResignPending] = useState(false);
  const [resignError, setResignError] = useState<string | null>(null);
  const surfaceRef = useRef<GameSurfaceFrameHandle>(null);
  const reducedMotion = useReducedMotionPreference();
  const locale =
    typeof navigator === "undefined" ? "zh-CN" : navigator.language || "zh-CN";
  const {
    busy,
    closeRoom,
    host,
    leaveRoom,
    openNextRoundSetup,
    startRematch,
    state,
  } = useGameRoomHost();
  const snapshot = state.snapshot;
  const lifecycle = state.roomLifecycle;
  const room = state.room;
  const surfaceEntrypoint =
    room === null
      ? undefined
      : resolveGameSurfaceEntrypoint(room.gameId, room.gameVersion, "play");
  if (room === null || lifecycle === null || snapshot === null) {
    return <LoadingView label="正在同步对局…" />;
  }
  if (surfaceEntrypoint === undefined) return <SurfaceUnavailableView />;
  const isCompleted = snapshot.status === "completed";
  const canResign =
    snapshot.status === "active" &&
    snapshot.viewer.kind === "player" &&
    surfaceEntrypoint.platformControls.includes("RESIGN");
  const resign = async (): Promise<void> => {
    const surface = surfaceRef.current;
    if (!canResign || surface === null || resignPending) return;
    if (!window.confirm(RESIGN_CONFIRMATION_MESSAGE)) return;

    setResignPending(true);
    setResignError(null);
    try {
      const result = await surface.requestResign();
      if (result.status !== "accepted") {
        setResignError("游戏画面未能处理投降，请重试。");
      }
    } catch {
      setResignError("游戏画面未能处理投降，请重试。");
    } finally {
      setResignPending(false);
    }
  };
  return (
    <PlaySurfaceShell
      busy={busy}
      canResign={canResign}
      completed={isCompleted}
      errorMessage={resignError ?? undefined}
      modeLabel="实际对局"
      onAdjustSettings={() => void openNextRoundSetup()}
      onCloseRoom={() => void closeRoom()}
      onLeaveRoom={() => void leaveRoom()}
      onRematch={() => void startRematch()}
      onResign={() => void resign()}
      owner={lifecycle.isOwner}
      overlays={
        <>
          <PageAlerts />
          <RoomToast />
        </>
      }
      playerSlotId={room.playerSlotId}
      resignPending={resignPending}
      revision={snapshot.revision}
      roomCode={room.roomCode}
      roundNumber={snapshot.roundNumber}
      stage={
        <GameSurfaceFrame
          connectionState={state.connectionState}
          entrypoint={surfaceEntrypoint}
          locale={locale}
          onIntent={async (intent) => {
            try {
              await host.submitAction(intent);
              return { status: "accepted" };
            } catch {
              return { status: "rejected", code: "HOST_REJECTED" };
            }
          }}
          outcome={snapshot.outcome}
          payload={snapshot.view}
          readOnly={isCompleted}
          reducedMotion={reducedMotion}
          ref={surfaceRef}
          revision={snapshot.revision}
          roundNumber={snapshot.roundNumber}
        />
      }
      state={state}
      title={title}
    />
  );
}

function RealtimePlayView({ title }: Pick<GameRoomPageProps, "title">) {
  const [resignPending, setResignPending] = useState(false);
  const [resignError, setResignError] = useState<string | null>(null);
  const surfaceRef = useRef<GameSurfaceFrameHandle>(null);
  const reducedMotion = useReducedMotionPreference();
  const locale =
    typeof navigator === "undefined" ? "zh-CN" : navigator.language || "zh-CN";
  const {
    busy,
    closeRoom,
    host,
    leaveRoom,
    openNextRoundSetup,
    startRematch,
    state,
  } = useGameRoomHost();
  const snapshot = state.snapshot;
  const lifecycle = state.roomLifecycle;
  const room = state.room;
  const surfaceEntrypoint =
    room === null
      ? undefined
      : resolveGameSurfaceEntrypoint(room.gameId, room.gameVersion, "play");

  if (room === null || lifecycle === null || snapshot === null) {
    return <LoadingView label="正在同步实时对局…" />;
  }
  if (surfaceEntrypoint === undefined) return <SurfaceUnavailableView />;
  const isCompleted = snapshot.status === "completed";
  const canResign =
    snapshot.status === "active" &&
    snapshot.viewer.kind === "player" &&
    surfaceEntrypoint.platformControls.includes("RESIGN");
  const resign = async (): Promise<void> => {
    const surface = surfaceRef.current;
    if (!canResign || surface === null || resignPending) return;
    if (!window.confirm(RESIGN_CONFIRMATION_MESSAGE)) return;
    setResignPending(true);
    setResignError(null);
    try {
      const result = await surface.requestResign();
      if (result.status !== "accepted") {
        setResignError("游戏画面未能处理投降，请重试。");
      }
    } catch {
      setResignError("游戏画面未能处理投降，请重试。");
    } finally {
      setResignPending(false);
    }
  };
  return (
    <PlaySurfaceShell
      busy={busy}
      canResign={canResign}
      completed={isCompleted}
      errorMessage={resignError ?? undefined}
      modeLabel="实时对局"
      onAdjustSettings={() => void openNextRoundSetup()}
      onCloseRoom={() => void closeRoom()}
      onLeaveRoom={() => void leaveRoom()}
      onRematch={() => void startRematch()}
      onResign={() => void resign()}
      owner={lifecycle.isOwner}
      overlays={
        <>
          <PageAlerts />
          <RoomToast />
        </>
      }
      playerSlotId={room.playerSlotId}
      resignPending={resignPending}
      revision={snapshot.revision}
      roomCode={room.roomCode}
      roundNumber={snapshot.roundNumber}
      stage={
        <GameSurfaceFrame
          connectionState={state.connectionState}
          entrypoint={surfaceEntrypoint}
          locale={locale}
          onIntent={async (intent) => {
            try {
              await host.submitInput(intent);
              return { status: "accepted" };
            } catch {
              return { status: "rejected", code: "HOST_REJECTED" };
            }
          }}
          outcome={snapshot.outcome}
          payload={snapshot.view}
          readOnly={isCompleted}
          reducedMotion={reducedMotion}
          ref={surfaceRef}
          roundNumber={snapshot.roundNumber}
          tick={snapshot.tick ?? snapshot.revision}
        />
      }
      state={state}
      statusProbes={
        <>
          <span className="sr-only" data-testid="server-tick">
            {snapshot.tick ?? snapshot.revision}
          </span>
          <span className="sr-only" data-testid="acknowledged-input-sequence">
            {snapshot.acknowledgedInputSequence ?? 0}
          </span>
        </>
      }
      title={title}
    />
  );
}

function PlayView({ title }: Pick<GameRoomPageProps, "title">) {
  const { runtime } = useGameRoomHost();
  return runtime === "realtime" ? (
    <RealtimePlayView title={title} />
  ) : (
    <TurnBasedPlayView title={title} />
  );
}

export function GameRoomPage(props: GameRoomPageProps) {
  if (props.mode === "entry")
    return <EntryView title={props.title} description={props.description} />;
  if (props.mode === "room") return <RoomView title={props.title} />;
  return <PlayView title={props.title} />;
}
