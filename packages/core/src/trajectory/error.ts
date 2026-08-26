import { Formatter, Schema } from "effect";

export class StorageFailed extends Schema.TaggedError<StorageFailed>(
  "open-insight/TrajectoryError/StorageFailed",
)("StorageFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Trajectory storage failed: ${Formatter.format(this.cause)}`;
  }
}

export class DecodeFailed extends Schema.TaggedError<DecodeFailed>(
  "open-insight/TrajectoryError/DecodeFailed",
)("DecodeFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Trajectory response decoding failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([StorageFailed, DecodeFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class TrajectoryError extends Schema.TaggedError<TrajectoryError>(
  "open-insight/TrajectoryError",
)("TrajectoryError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static storage = (cause: unknown): TrajectoryError =>
    TrajectoryError.make({
      reason: StorageFailed.make({ cause }),
    });

  static decode = (cause: unknown): TrajectoryError =>
    TrajectoryError.make({
      reason: DecodeFailed.make({ cause }),
    });
}
