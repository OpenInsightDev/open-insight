import { Schema } from "effect";

const Cause = Schema.Error();

export class StreamError extends Schema.TaggedErrorClass<StreamError>()("StreamError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Agent response stream failed: ${this.cause.message}`;
  }
}

export class TrajectoryError extends Schema.TaggedErrorClass<TrajectoryError>()("TrajectoryError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Agent trajectory failed: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([StreamError, TrajectoryError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("AgentError", {
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

  static stream = this.mapUnknownError((cause) => new StreamError({ cause }));

  static trajectory = this.mapUnknownError((cause) => new TrajectoryError({ cause }));
}
