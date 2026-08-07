import { Formatter, Schema } from "effect";

/** A skills directory or discovered SKILL.md file could not be read. */
export class SourceError extends Schema.TaggedError<SourceError>(
  "open-insight/SkillsError/SourceError",
)("SourceError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to read Agent Skills source "${this.path}": ${Formatter.format(this.cause)}`;
  }
}

/** A discovered SKILL.md file does not conform to the Agent Skills specification. */
export class InvalidMetadata extends Schema.TaggedError<InvalidMetadata>(
  "open-insight/SkillsError/InvalidMetadata",
)("InvalidMetadata", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid Agent Skills metadata in "${this.path}": ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([SourceError, InvalidMetadata]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by skill discovery and preparation. */
export class SkillsError extends Schema.TaggedError<SkillsError>("open-insight/SkillsError")(
  "SkillsError",
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

  static source =
    (path: string) =>
    (cause: unknown): SkillsError =>
      SkillsError.make({ reason: SourceError.make({ path, cause }) });

  static metadata =
    (path: string) =>
    (cause: unknown): SkillsError =>
      SkillsError.make({ reason: InvalidMetadata.make({ path, cause }) });
}
