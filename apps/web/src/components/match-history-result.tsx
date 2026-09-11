import type { MatchHistoryResult } from "@online-game-hub/game-registry/history-types";

export function MatchHistoryResultView({
  result,
}: {
  readonly result: MatchHistoryResult | null;
}) {
  if (result === null) {
    return <span className="history-result is-unavailable">结果暂不可用</span>;
  }
  if (result.kind === "score") {
    return (
      <span className="history-result is-score">
        <strong>
          {result.own} : {result.opponent}
        </strong>
        <small>我方 : 对方</small>
      </span>
    );
  }
  if (result.kind === "rank") {
    return (
      <span className="history-result is-rank">
        {result.tied ? "并列第" : "第"} {result.rank} 名
      </span>
    );
  }
  const labels = { win: "胜利", loss: "失败", draw: "平局" };
  return (
    <span className={`history-result is-${result.value}`}>
      {labels[result.value]}
    </span>
  );
}
