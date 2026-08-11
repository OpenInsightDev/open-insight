import { Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;
