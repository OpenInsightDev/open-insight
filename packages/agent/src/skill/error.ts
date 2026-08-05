import { Schema } from "effect";

const Cause = Schema.Error();

/** A skills directory or discovered SKILL.md file could not be read. */
export class SourceError extends Schema.TaggedErrorClass<SourceError>()("SourceError", {
  path: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to read Agent Skills source "${this.path}": ${this.cause.message}`;
  }
}

/** A discovered SKILL.md file does not conform to the Agent Skills specification. */
export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>()("InvalidMetadata", {
  path: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Invalid Agent Skills metadata in "${this.path}": ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([SourceError, InvalidMetadata]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by skill discovery and preparation. */
export class Error extends Schema.TaggedErrorClass<Error>()("SkillsError", {
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

  static source = (path: string) =>
    this.mapUnknownError((cause) => new SourceError({ path, cause }));

  static metadata = (path: string) =>
    this.mapUnknownError((cause) => new InvalidMetadata({ path, cause }));
}
