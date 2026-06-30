import { Schema } from "effect";

export const ModeSchema = Schema.TaggedUnion({
  Dir: {
    path: Schema.String,
  },
  Script: {},
  Cwd: {},
});
export type Mode = Schema.Schema.Type<typeof ModeSchema>;

/**
 * Context dir for snapshot update operations.
 *
 * Any file operations (e.g. COPY) must be resolved relative to this path.
 */
export const ContextSchema = Schema.String;
export type Context = Schema.Schema.Type<typeof ContextSchema>;
