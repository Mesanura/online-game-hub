"use client";

import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { loadGameClientModule } from "@online-game-hub/game-registry/client";
import { gameCatalog } from "@online-game-hub/game-registry/catalog";
import type { UnknownGameClientModule } from "@online-game-hub/game-client-sdk";

type ReplayFrame = { readonly revision: number; readonly view: unknown };
type ReplayPayload = {
  readonly match: {
    readonly roundNumber: number;
    readonly gameId: string;
    readonly gameVersion: string;
    readonly status: "completed";
    readonly finalRevision: number;
    readonly createdAt: string;
    readonly startedAt: string;
    readonly finishedAt: string;
  };
  readonly frames: readonly ReplayFrame[];
};

function isReplayPayload(input: unknown): input is ReplayPayload {
  if (input === null || typeof input !== "object") return false;
  const payload = input as {
    readonly match?: unknown;
    readonly frames?: unknown;
  };
  return (
    payload.match !== null &&
    typeof payload.match === "object" &&
    Array.isArray(payload.frames)
  );
}

export default function ReplayPage({
  params,
}: {
  readonly params: Promise<{ readonly matchId: string }>;
}) {
  const { matchId } = use(params);
  const router = useRouter();
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [module, setModule] = useState<UnknownGameClientModule | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/matches/${encodeURIComponent(matchId)}/replay`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace(
            `/login?next=${encodeURIComponent(`/account/matches/${matchId}/replay`)}`,
          );
          throw new Error("REPLAY_UNAVAILABLE");
        }
        const body = (await response.json()) as unknown;
        if (!response.ok || !isReplayPayload(body)) {
          throw new Error(
            response.status === 409
              ? "REPLAY_UNAVAILABLE"
              : "REPLAY_LOAD_FAILED",
          );
        }
        const loaded = await loadGameClientModule(
          body.match.gameId,
          body.match.gameVersion,
        );
        if (loaded === undefined) throw new Error("REPLAY_UNAVAILABLE");
        if (!cancelled) {
          setPayload(body);
          setModule(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setPlaying(false);
          setError(
            caught instanceof Error && caught.message === "REPLAY_UNAVAILABLE"
              ? "该对局暂不可回放。"
              : "回放加载失败，请稍后重试。",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, router]);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => () => stopTimer(), []);
  useEffect(() => {
    stopTimer();
    if (!playing || payload === null) return;
    timerRef.current = setInterval(() => {
      setFrameIndex((current) => {
        if (current >= payload.frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 700);
    return stopTimer;
  }, [playing, payload]);

  const frame = payload?.frames[frameIndex] ?? null;
  const parsedView = useMemo(() => {
    if (module === null || frame === null) return null;
    try {
      return module.parseView(frame.view);
    } catch {
      return null;
    }
  }, [module, frame]);
  const title =
    payload === null
      ? "回放中心"
      : (gameCatalog.find((game) => game.id === payload.match.gameId)?.title ??
        "回放中心");

  if (payload === null || module === null) {
    return (
      <div
        className="page-shell replay-page"
        data-testid={error === null ? "replay-loading" : "replay-error"}
      >
        <Link className="text-link" href="/account/matches">
          <ArrowLeft size={18} aria-hidden="true" /> 返回我的对局
        </Link>
        <h1>{error === null ? "正在加载回放…" : error}</h1>
        {error !== null ? (
          <p data-testid="replay-unavailable">这局比赛没有可用的完整回放。</p>
        ) : null}
      </div>
    );
  }
  if (parsedView === null || frame === null) {
    return (
      <div className="page-shell replay-page" data-testid="replay-error">
        <h1>回放数据无效</h1>
      </div>
    );
  }
  const GameComponent = module.Component;
  const lastIndex = payload.frames.length - 1;
  const move = (next: number) => {
    setPlaying(false);
    setFrameIndex(Math.min(lastIndex, Math.max(0, next)));
  };
  return (
    <div className="page-shell replay-page" data-testid="replay-page">
      <header className="replay-heading">
        <Link className="text-link" href="/account/matches">
          <ArrowLeft size={18} aria-hidden="true" /> 返回我的对局
        </Link>
        <p className="eyebrow">账户回放</p>
        <h1>{title}</h1>
        <p>
          第 {payload.match.roundNumber} 局 · 版本 {payload.match.gameVersion}
        </p>
      </header>
      <main className="replay-main">
        <section
          className="replay-board-shell clay-surface"
          data-testid="replay-board"
        >
          <div className="replay-frame-label" data-testid="replay-frame">
            第 {frame.revision} 帧
          </div>
          <GameComponent
            readOnly
            connectionState="closed"
            revision={frame.revision}
            submitAction={async () => undefined}
            view={parsedView as Readonly<unknown>}
          />
        </section>
        <section className="replay-controls clay-surface" aria-label="回放控制">
          <span data-testid="replay-frame-count">
            {frameIndex + 1} / {payload.frames.length}
          </span>
          <div className="replay-control-buttons">
            <button
              aria-label="首帧"
              title="首帧"
              data-testid="replay-first"
              className="icon-button"
              disabled={frameIndex === 0}
              onClick={() => move(0)}
              type="button"
            >
              <SkipBack size={22} aria-hidden="true" />
            </button>
            <button
              aria-label="上一帧"
              title="上一帧"
              data-testid="replay-previous"
              className="icon-button"
              disabled={frameIndex === 0}
              onClick={() => move(frameIndex - 1)}
              type="button"
            >
              <CaretLeft size={22} aria-hidden="true" />
            </button>
            <button
              aria-label={playing ? "暂停" : "播放"}
              title={playing ? "暂停" : "播放"}
              data-testid="replay-toggle"
              className="icon-button"
              onClick={() => setPlaying((current) => !current)}
              type="button"
            >
              {playing ? (
                <Pause size={22} aria-hidden="true" />
              ) : (
                <Play size={22} aria-hidden="true" />
              )}
            </button>
            <button
              aria-label="下一帧"
              title="下一帧"
              data-testid="replay-next"
              className="icon-button"
              disabled={frameIndex === lastIndex}
              onClick={() => move(frameIndex + 1)}
              type="button"
            >
              <CaretRight size={22} aria-hidden="true" />
            </button>
            <button
              aria-label="末帧"
              title="末帧"
              data-testid="replay-last"
              className="icon-button"
              disabled={frameIndex === lastIndex}
              onClick={() => move(lastIndex)}
              type="button"
            >
              <SkipForward size={22} aria-hidden="true" />
            </button>
          </div>
          <input
            aria-label="回放进度"
            data-testid="replay-slider"
            max={lastIndex}
            min={0}
            onChange={(event) => move(Number(event.target.value))}
            type="range"
            value={frameIndex}
          />
        </section>
      </main>
    </div>
  );
}
