import { Formatter, Schema } from "effect";

/** The metadata describing a metric is invalid. */
export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>(
  "open-insight/eval/MetricError/InvalidMetadata",
)("InvalidMetadata", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid metric metadata: ${Formatter.format(this.cause)}`;
  }
}

/** A metric execution could not produce the expected result. */
export class ExecutionFailed extends Schema.TaggedErrorClass<ExecutionFailed>(
  "open-insight/eval/MetricError/ExecutionFailed",
)("ExecutionFailed", {
  metric: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Metric "${this.metric}" execution failed: ${Formatter.format(this.cause)}`;
  }
}

/** A calculated value does not satisfy the metric result contract. */
export class InvalidResult extends Schema.TaggedErrorClass<InvalidResult>(
  "open-insight/eval/MetricError/InvalidResult",
)("InvalidResult", {
  metric: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Metric "${this.metric}" produced an invalid result: ${Formatter.format(this.cause)}`;
  }
}

/** A metric result could not be projected into chart data. */
export class ChartFailed extends Schema.TaggedErrorClass<ChartFailed>(
  "open-insight/eval/MetricError/ChartFailed",
)("ChartFailed", {
  metric: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Metric "${this.metric}" chart generation failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([
  InvalidMetadata,
  ExecutionFailed,
  InvalidResult,
  ChartFailed,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by metric construction and evaluation. */
export class MetricError extends Schema.TaggedErrorClass<MetricError>(
  "open-insight/eval/MetricError",
)("MetricError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static metadata = (cause: unknown): MetricError =>
    MetricError.make({ reason: InvalidMetadata.make({ cause }) });

  static exec =
    (metric: string) =>
    (cause: unknown): MetricError =>
      MetricError.make({ reason: ExecutionFailed.make({ metric, cause }) });

  static result =
    (metric: string) =>
    (cause: unknown): MetricError =>
      MetricError.make({ reason: InvalidResult.make({ metric, cause }) });

  static chart =
    (metric: string) =>
    (cause: unknown): MetricError =>
      MetricError.make({ reason: ChartFailed.make({ metric, cause }) });
}
