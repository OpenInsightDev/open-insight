import { Schema } from "effect";

export const Name = Schema.String.check(
  Schema.isLengthBetween(1, 64),
  Schema.isPattern(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u),
  Schema.makeFilter((name) => name === name.toLowerCase(), {
    expected: "a lowercase skill name",
  }),
);

export const Description = Schema.String.check(
  Schema.isLengthBetween(1, 1024),
  Schema.isPattern(/\S/),
);

export const Compatibility = Schema.String.check(
  Schema.isLengthBetween(1, 500),
  Schema.isPattern(/\S/),
);

export const CustomMetadata = Schema.Record(Schema.String, Schema.String);

/** Frontmatter metadata defined by the Agent Skills specification. */
export class Metadata extends Schema.Class<Metadata>("SkillMetadata")({
  name: Name,
  description: Description,
  license: Schema.optional(Schema.String),
  compatibility: Schema.optional(Compatibility),
  metadata: Schema.optional(CustomMetadata),
  "allowed-tools": Schema.optional(Schema.String),
}) {}
