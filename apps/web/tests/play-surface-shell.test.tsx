import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WebRoomHostState } from "../src/components/game-room-host";
import { PlaySurfaceShell } from "../src/components/game-room-page";

const connectedState: WebRoomHostState = {
  connectionState: "connected",
  room: null,
  roomLifecycle: null,
  previousSnapshot: null,
  snapshot: null,
  rejection: null,
  error: null,
};

function renderShell() {
  return renderToStaticMarkup(
    <PlaySurfaceShell
      busy={false}
      canReady
      canResign
      completed={false}
      errorMessage={undefined}
      modeLabel="实际对局"
      onAdjustSettings={() => undefined}
      onCloseRoom={() => undefined}
      onLeaveRoom={() => undefined}
      onRematch={() => Promise.resolve()}
      onResign={() => undefined}
      owner
      protocolVersion={6}
      playerSlotId="slot-1"
      resignPending={false}
      resultSummary={null}
      readyPlayerCount={0}
      requiredPlayerCount={2}
      revision={7}
      roomCode="ROOM1234"
      roundNumber={2}
      stage={<div data-testid="fake-game">独立游戏画面</div>}
      state={connectedState}
      selfReady={false}
      title="测试游戏"
    />,
  );
}

describe("PlaySurfaceShell", () => {
  it("默认保持平台抽屉关闭并让游戏舞台独占布局", () => {
    const html = renderShell();

    expect(html).toContain('data-testid="game-stage"');
    expect(html).toContain('data-testid="toggle-game-hud"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('data-testid="resign-game"');
  });

  it("在舞台外只暴露平台状态探针", () => {
    const html = renderShell();

    expect(html).toContain('data-testid="room-code"');
    expect(html).toContain("ROOM1234");
    expect(html).toContain('data-testid="round-number"');
    expect(html).toContain("第 2 局");
    expect(html).toContain('class="sr-only" data-testid="connection-state"');
    expect(html).not.toContain("connection-badge-online");
    expect(html).toContain('data-testid="revision"');
    expect(html).not.toContain('data-testid="score-left"');
    expect(html).not.toContain('data-testid="pong-outcome"');
  });

  it("终局时在抽屉外显示 Surface 结果与重新对局操作", () => {
    const html = renderToStaticMarkup(
      <PlaySurfaceShell
        busy={false}
        canReady
        canResign={false}
        completed
        errorMessage={undefined}
        modeLabel="实际对局"
        onAdjustSettings={() => undefined}
        onCloseRoom={() => undefined}
        onLeaveRoom={() => undefined}
        onRematch={() => Promise.resolve()}
        onResign={() => undefined}
        owner
        playerSlotId="slot-1"
        protocolVersion={6}
        readyPlayerCount={1}
        requiredPlayerCount={2}
        resignPending={false}
        resultSummary={{
          type: "surface.result-summary",
          stateSequence: 4,
          tone: "win",
          headline: "你获胜",
          details: ["本局因投降结束"],
        }}
        revision={7}
        roomCode="ROOM1234"
        roundNumber={2}
        selfReady
        stage={<div>独立游戏画面</div>}
        state={connectedState}
        title="测试游戏"
      />,
    );

    expect(html).toContain('data-testid="game-result-hud"');
    expect(html).toContain("你获胜");
    expect(html).toContain("等待其余 1 名玩家确认");
    expect(html).toContain("取消重新对局确认，当前还需 1 名玩家确认");
    expect(html).toContain('data-testid="next-round-settings"');
    expect(html).not.toContain('role="dialog"');
  });
});
