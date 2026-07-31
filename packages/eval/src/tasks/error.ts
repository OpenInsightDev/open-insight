import { Schema } from "effect";

const Cause = Schema.Error();

/** A task source could not be accessed or prepared. */
export class SourceError extends Schema.TaggedErrorClass<SourceError>()("SourceError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to access task source: ${this.cause.message}`;
  }
}

/** A resolved value could not be interpreted as a valid task. */
export class InvalidTaskError extends Schema.TaggedErrorClass<InvalidTaskError>()(
  "InvalidTaskError",
  {
    cause: Cause,
  },
) {
  override get message(): string {
    return `Invalid task: ${this.cause.message}`;
  }
}

/** A valid task requires capabilities that are not supported. */
export class UnsupportedTaskError extends Schema.TaggedErrorClass<UnsupportedTaskError>()(
  "UnsupportedTaskError",
  {
    cause: Cause,
  },
) {
  override get message(): string {
    return `Unsupported task: ${this.cause.message}`;
  }
}

/** A task could not be constructed or initialized. */
export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize task collection: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([
  SourceError,
  InvalidTaskError,
  UnsupportedTaskError,
  InitError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by task collection operations. */
export class Error extends Schema.TaggedErrorClass<Error>()("TasksError", {
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

  static source = this.mapUnknownError((cause) => new SourceError({ cause }));

  static invalid = this.mapUnknownError((cause) => new InvalidTaskError({ cause }));

  static unsupported = this.mapUnknownError((cause) => new UnsupportedTaskError({ cause }));

  static init = this.mapUnknownError((cause) => new InitError({ cause }));
}
