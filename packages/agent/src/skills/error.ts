import { Schema } from "effect";

/** A skills directory or discovered SKILL.md file could not be read. */
export class SourceError extends Schema.TaggedErrorClass<SourceError>()("SkillSourceError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A discovered SKILL.md file does not conform to the Agent Skills specification. */
export class InvalidMetadataError extends Schema.TaggedErrorClass<InvalidMetadataError>()(
  "InvalidSkillMetadataError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const Error = Schema.Union([SourceError, InvalidMetadataError]);
export type Error = Schema.Schema.Type<typeof Error>;
