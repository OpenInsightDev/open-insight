import { IDSchema } from "#/utils/id.ts";
import { Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: IDSchema,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}

export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;
