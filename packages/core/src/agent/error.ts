import { Schema } from "effect";

const Cause = Schema.Error();

export class StreamError extends Schema.TaggedErrorClass<StreamError>(
  "open-insight/AgentError/StreamError",
)("StreamError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Agent response stream failed: ${this.cause.message}`;
  }
}

export class TrajectoryError extends Schema.TaggedErrorClass<TrajectoryError>(
  "open-insight/AgentError/TrajectoryError",
)("TrajectoryError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Agent trajectory failed: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([StreamError, TrajectoryError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class AgentError extends Schema.TaggedErrorClass<AgentError>("open-insight/AgentError")(
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
      reason: StreamError.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });

  static trajectory = (cause: unknown): AgentError =>
    AgentError.make({
      reason: TrajectoryError.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });
}
