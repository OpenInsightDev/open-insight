import { Schema } from "effect";

export const Assertion = Schema.TaggedUnion({
  Success: {
    command: Schema.String,
  },
  Equal: {
    command: Schema.String,
    expected: Schema.String,
  },
  Program: {
    program: Schema.String,
  },
  Env: {
    name: Schema.String,
    value: Schema.optional(Schema.String),
  },
  Exists: {
    path: Schema.String,
  },
});
export type Assertion = Schema.Schema.Type<typeof Assertion>;

export const AssertSchema = Schema.Array(Assertion);
export type Assert = Schema.Schema.Type<typeof AssertSchema>;
