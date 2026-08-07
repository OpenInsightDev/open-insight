import { Formatter, Schema } from "effect";

export class StreamError extends Schema.TaggedError<StreamError>(
  "open-insight/AgentError/StreamError",
)("StreamError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Agent response stream failed: ${Formatter.format(this.cause)}`;
  }
}

export class TrajectoryError extends Schema.TaggedError<TrajectoryError>(
  "open-insight/AgentError/TrajectoryError",
)("TrajectoryError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Agent trajectory failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([StreamError, TrajectoryError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class AgentError extends Schema.TaggedError<AgentError>("open-insight/AgentError")(
  "AgentError",
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

  static stream = (cause: unknown): AgentError =>
    AgentError.make({
      reason: StreamError.make({ cause }),
    });

  static trajectory = (cause: unknown): AgentError =>
    AgentError.make({
      reason: TrajectoryError.make({ cause }),
    });
}
