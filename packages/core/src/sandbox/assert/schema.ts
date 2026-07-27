import { Schema } from "effect";

export const Assertion = Schema.TaggedUnion({
  /**
   * Expects the command to exit with code 0.
   */
  Success: {
    command: Schema.String,
  },
  /**
   * Expects the command to exit with code 0 and stdout to equal the expected string.
   */
  Equal: {
    command: Schema.String,
    expected: Schema.String,
  },
  /**
   * Expects the given program is available in the sandbox.
   */
  Program: {
    program: Schema.String,
  },
  /**
   * Expects the version of the program (given by command) to satisfy the given semver range (given by range).
   */
  Version: {
    command: Schema.String,
    range: Schema.String,
  },
  /**
   * Expects the given environment variable to be set to the given value in default shell environment.
   */
  Env: {
    name: Schema.String,
    value: Schema.optional(Schema.String),
  },
  /**
   * Expects the given file/directory to exist in the sandbox.
   */
  Exists: {
    path: Schema.String,
  },
});
export type Assertion = Schema.Schema.Type<typeof Assertion>;

export const AssertSchema = Schema.Array(Assertion);
export type Assert = Schema.Schema.Type<typeof AssertSchema>;
