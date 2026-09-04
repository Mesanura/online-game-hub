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
      canResign
      completed={false}
      errorMessage={undefined}
      modeLabel="实际对局"
      onAdjustSettings={() => undefined}
      onCloseRoom={() => undefined}
      onLeaveRoom={() => undefined}
      onRematch={() => undefined}
      onResign={() => undefined}
      owner
      playerSlotId="slot-1"
      resignPending={false}
      revision={7}
      roomCode="ROOM1234"
      roundNumber={2}
      stage={<div data-testid="fake-game">独立游戏画面</div>}
      state={connectedState}
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
    expect(html).toContain('data-testid="connection-state"');
    expect(html).toContain('data-testid="revision"');
    expect(html).not.toContain('data-testid="score-left"');
    expect(html).not.toContain('data-testid="pong-outcome"');
  });
});
