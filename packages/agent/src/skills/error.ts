import { Schema } from "effect";

/** A skills directory or discovered SKILL.md file could not be read. */
export class SourceError extends Schema.TaggedErrorClass<SourceError>()("SourceError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A discovered SKILL.md file does not conform to the Agent Skills specification. */
export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>()("InvalidMetadata", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([SourceError, InvalidMetadata]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by skill discovery and preparation. */
export class Error extends Schema.TaggedErrorClass<Error>()("SkillsError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static source = (path: string) =>
    this.mapUnknownError((cause) => new SourceError({ path, cause }));

  static metadata = (path: string) =>
    this.mapUnknownError((cause) => new InvalidMetadata({ path, cause }));
}
