import type { MatchStatus, ProtocolErrorCode } from "@online-game-hub/protocol";

export type RuntimeMetricName =
  | "active_rooms"
  | "active_connections"
  | "actions_accepted_total"
  | "actions_rejected_total"
  | "reconnect_attempt_total"
  | "reconnect_success_total"
  | "reconnect_timeout_total"
  | "replay_append_failure_total"
  | "room_crash_total";

export interface MetricLabels {
  readonly gameId?: string;
  readonly gameVersion?: string;
}

export interface MetricSample {
  readonly name: RuntimeMetricName;
  readonly labels: MetricLabels;
  readonly value: number;
}

export interface MetricsCollector {
  increment(
    name: RuntimeMetricName,
    labels?: MetricLabels,
    amount?: number,
  ): void;
  setGauge(name: RuntimeMetricName, value: number, labels?: MetricLabels): void;
  snapshot(): readonly MetricSample[];
}

function metricKey(name: RuntimeMetricName, labels: MetricLabels): string {
  return `${name}\u0000${labels.gameId ?? ""}\u0000${labels.gameVersion ?? ""}`;
}

export class InMemoryMetricsCollector implements MetricsCollector {
  readonly #samples = new Map<string, MetricSample>();

  public increment(
    name: RuntimeMetricName,
    labels: MetricLabels = {},
    amount = 1,
  ): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError("Metric increment must be a non-negative number.");
    }
    const key = metricKey(name, labels);
    const current = this.#samples.get(key)?.value ?? 0;
    this.#samples.set(key, {
      name,
      labels: { ...labels },
      value: current + amount,
    });
  }

  public setGauge(
    name: RuntimeMetricName,
    value: number,
    labels: MetricLabels = {},
  ): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("Metric gauge must be a non-negative number.");
    }
    this.#samples.set(metricKey(name, labels), {
      name,
      labels: { ...labels },
      value,
    });
  }

  public snapshot(): readonly MetricSample[] {
    return [...this.#samples.values()]
      .map((sample) => ({ ...sample, labels: { ...sample.labels } }))
      .sort((left, right) =>
        metricKey(left.name, left.labels).localeCompare(
          metricKey(right.name, right.labels),
        ),
      );
  }
}

export interface RuntimeLogEvent {
  readonly event: string;
  readonly roomId?: string;
  readonly gameId?: string;
  readonly gameVersion?: string;
  readonly revision?: number;
  readonly code?: ProtocolErrorCode | "ROOM_CRASH";
  readonly sessionCorrelationId?: string;
  readonly status?: MatchStatus;
}

export interface RuntimeLogger {
  write(event: RuntimeLogEvent): void;
}

export const noopRuntimeLogger: RuntimeLogger = { write: () => undefined };

export function correlatePlayerSessionId(playerSessionId: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < playerSessionId.length; index += 1) {
    hash = Math.imul(hash ^ playerSessionId.charCodeAt(index), 0x01_00_01_93);
  }
  return `session-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
