import { ID } from "#/utils/schema.ts";
import { Schema } from "effect";
import * as Chart from "#/chart/index.ts";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: ID,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Result extends Schema.Class<Result>("Result")({
  id: Schema.String,
  value: Schema.Json,
  chart: Schema.NullOr(Chart.Points),
}) {}
export type ResultEncoded = Schema.Codec.Encoded<typeof Result>;
