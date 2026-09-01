import { ID } from "#/utils/schema.ts";
import { Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: ID,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export const Result = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({
    result: schema,

    id: Schema.String,

    /**
     * Timestamp when the metric value is emitted.
     */
    timestamp: Schema.DateTimeUtcFromString,

    /**
     * Associated trajectory part ID, if any.
     *
     * Available when the metric value is emitted according to a specific trajectory part.
     */
    partID: Schema.optional(Schema.String),
  });

export type Result<S extends Schema.Constraint> = Schema.Schema.Type<ReturnType<typeof Result<S>>>;
