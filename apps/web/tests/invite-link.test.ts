import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InviteButton } from "../src/components/game-room-page";

const inviteUrl = "https://games.example.test/games/gomoku/rooms/ABCD2345";

function render(copyState: "idle" | "copying" | "copied" | "failed") {
  return renderToStaticMarkup(
    createElement(InviteButton, {
      inviteUrl,
      copyState,
      onCopy: vi.fn(),
      onFallback: vi.fn(),
    }),
  );
}

describe("InviteButton", () => {
  it.each([
    ["idle", "复制邀请链接"],
    ["copying", "复制中…"],
    ["copied", "已复制"],
  ] as const)("renders the %s copy state", (state, label) => {
    const html = render(state);
    expect(html).toContain(label);
    expect(html).not.toContain("手动复制邀请链接");
  });

  it("renders an actionable manual fallback only after failure", () => {
    const html = render("failed");
    expect(html).toContain("复制失败，请选择下方链接手动复制。");
    expect(html).toContain("手动复制邀请链接");
    expect(html).toContain(inviteUrl);
    expect(html).toContain("选择链接");
  });
});
