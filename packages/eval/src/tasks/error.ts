import { Schema } from "effect";

/** A task source could not be accessed or prepared. */
export class SourceError extends Schema.TaggedErrorClass<SourceError>()("SourceError", {
  cause: Schema.Defect(),
}) {}

/** A resolved value could not be interpreted as a valid task. */
export class InvalidTaskError extends Schema.TaggedErrorClass<InvalidTaskError>()(
  "InvalidTaskError",
  {
    cause: Schema.Defect(),
  },
) {}

/** A valid task requires capabilities that are not supported. */
export class UnsupportedTaskError extends Schema.TaggedErrorClass<UnsupportedTaskError>()(
  "UnsupportedTaskError",
  {
    cause: Schema.Defect(),
  },
) {}

/** A task could not be constructed or initialized. */
export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

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
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static source = this.mapUnknownError((cause) => new SourceError({ cause }));

  static invalid = this.mapUnknownError((cause) => new InvalidTaskError({ cause }));

  static unsupported = this.mapUnknownError((cause) => new UnsupportedTaskError({ cause }));

  static init = this.mapUnknownError((cause) => new InitError({ cause }));
}
