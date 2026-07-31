import { Schema } from "effect";

const Cause = Schema.Error();

/** The metadata describing a metric is invalid. */
export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>()("InvalidMetadata", {
  cause: Cause,
}) {
  override get message(): string {
    return `Invalid metric metadata: ${this.cause.message}`;
  }
}

/** A metric execution could not produce the expected result. */
export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  metric: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Metric "${this.metric}" execution failed: ${this.cause.message}`;
  }
}

/** A calculated value does not satisfy the metric result contract. */
export class InvalidResult extends Schema.TaggedErrorClass<InvalidResult>()("InvalidResult", {
  metric: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Metric "${this.metric}" produced an invalid result: ${this.cause.message}`;
  }
}

/** A metric result could not be projected into chart data. */
export class ChartError extends Schema.TaggedErrorClass<ChartError>()("ChartError", {
  metric: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Metric "${this.metric}" chart generation failed: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([InvalidMetadata, ExecError, InvalidResult, ChartError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by metric construction and evaluation. */
export class Error extends Schema.TaggedErrorClass<Error>()("MetricError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static mapUnknownError = (mapper: (cause: globalThis.Error) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error
      ? cause
      : new Error({ reason: mapper(Schema.decodeUnknownSync(Cause)(cause)) });

  static metadata = this.mapUnknownError((cause) => new InvalidMetadata({ cause }));

  static exec = (metric: string) =>
    this.mapUnknownError((cause) => new ExecError({ metric, cause }));

  static result = (metric: string) =>
    this.mapUnknownError((cause) => new InvalidResult({ metric, cause }));

  static chart = (metric: string) =>
    this.mapUnknownError((cause) => new ChartError({ metric, cause }));
}
