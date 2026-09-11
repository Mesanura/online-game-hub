import type { HostSurfaceMessage } from "@online-game-hub/game-surface-bridge";

type IntentResult = Extract<HostSurfaceMessage, { type: "host.intent-result" }>;

export function setupNotice(
  status: IntentResult["status"],
  code?: string,
): string | null {
  if (status === "accepted") return null;
  if (status === "stale" || code === "STALE_SETUP_REVISION")
    return "设置已被更新，请查看当前选择后重试。";
  switch (code) {
    case "NOT_OWNER":
      return "只有房主可以修改本局规则，请联系房主调整。";
    case "SETUP_UNCHANGED":
      return "设置没有变化，已保留当前选择。";
    case "INVALID_FIXED_STARTER":
      return "上一局的先手玩家已离开，请重新选择先手。";
    case "PLAYERS_NOT_READY":
      return "请等待参与者到齐并完成设置。";
    case "ROUND_NOT_IN_SETUP":
    case "ROUND_ALREADY_STARTED":
      return "本局已开始，下一局开始前可以调整设置。";
    case "HOST_REJECTED":
    case "INTENT_TIMEOUT":
      return "连接未能确认设置，请检查连接后重试。";
    default:
      return "这次操作未被接受，请查看当前设置后重试。";
  }
}
