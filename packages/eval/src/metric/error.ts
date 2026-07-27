import { Schema } from "effect";

/** The metadata describing a metric is invalid. */
export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>()("InvalidMetadata", {
  cause: Schema.Defect(),
}) {}

/** A metric execution could not produce the expected result. */
export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  metric: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A calculated value does not satisfy the metric result contract. */
export class InvalidResult extends Schema.TaggedErrorClass<InvalidResult>()("InvalidResult", {
  metric: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A metric result could not be projected into chart data. */
export class ChartError extends Schema.TaggedErrorClass<ChartError>()("ChartError", {
  metric: Schema.String,
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([InvalidMetadata, ExecError, InvalidResult, ChartError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by metric construction and evaluation. */
export class Error extends Schema.TaggedErrorClass<Error>()("MetricError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static metadata = this.mapUnknownError((cause) => new InvalidMetadata({ cause }));

  static exec = (metric: string) =>
    this.mapUnknownError((cause) => new ExecError({ metric, cause }));

  static result = (metric: string) =>
    this.mapUnknownError((cause) => new InvalidResult({ metric, cause }));

  static chart = (metric: string) =>
    this.mapUnknownError((cause) => new ChartError({ metric, cause }));
}
