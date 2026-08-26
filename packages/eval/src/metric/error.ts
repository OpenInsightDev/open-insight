import { Formatter, Schema } from "effect";

/** A response part does not match the schema declared by its tool. */
export class ToolSchemaMismatch extends Schema.TaggedError<ToolSchemaMismatch>(
  "open-insight/eval/MetricError/ToolSchemaMismatch",
)("ToolSchemaMismatch", {
  name: Schema.String,
  cause: Schema.Defect(),
  data: Schema.Unknown,
}) {
  override get message(): string {
    return `Tool schema mismatch for ${this.name}: ${Formatter.format(this.cause)}`;
  }
}

export class TransformFailed extends Schema.TaggedError<TransformFailed>(
  "open-insight/eval/MetricError/TransformFailed",
)("TransformFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Error transforming into metric stream: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([ToolSchemaMismatch, TransformFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** Errors raised while evaluating a metric. */
export class MetricError extends Schema.TaggedError<MetricError>("open-insight/eval/MetricError")(
  "MetricError",
  {
    reason: ErrorReason,
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static toolMismatch = (name: string, data: unknown) => (cause: Schema.SchemaError) =>
    MetricError.make({
      reason: ToolSchemaMismatch.make({ cause, name, data }),
    });

  static transform = (cause: unknown) =>
    MetricError.make({
      reason: TransformFailed.make({ cause }),
    });
}
