import { Schema } from "effect";

export class Config extends Schema.Class<Config>("Agent.Config")({
  apiKey: Schema.RedactedFromValue(Schema.String),
  baseUrl: Schema.String,
  model: Schema.String,
}) {}
export type ConfigEncoded = Schema.Codec.Encoded<typeof Config>;
