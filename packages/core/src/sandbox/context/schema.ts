import { Schema } from "effect";

export const DistFileType = Schema.Literal(".tar.gz");
export type DistFileType = Schema.Schema.Type<typeof DistFileType>;

export const ModeSchema = Schema.TaggedUnion({
  Dir: {
    path: Schema.String,
  },
  Dist: {
    url: Schema.String,
    fileType: DistFileType,
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
