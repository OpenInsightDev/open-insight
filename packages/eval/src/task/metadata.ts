import { Schema } from "effect";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;
