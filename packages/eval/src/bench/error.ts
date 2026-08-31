import { Formatter, Schema } from "effect";

/** A benchmark result could not be calculated. */
export class ResultFailed extends Schema.TaggedError<ResultFailed>(
  "open-insight/eval/BenchError/ResultFailed",
)("ResultFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Benchmark result calculation failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([ResultFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by benchmark operations. */
export class BenchError extends Schema.TaggedError<BenchError>("open-insight/eval/BenchError")(
  "BenchError",
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

  static result = (cause: unknown): BenchError =>
    BenchError.make({ reason: ResultFailed.make({ cause }) });
}
