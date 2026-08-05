import { Schema } from "effect";
import { JsonRecord } from "../common/config.ts";

export class Metrics extends Schema.Class<Metrics>("Metrics")({
  prompt_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  cached_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  cost_usd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  prompt_token_ids: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Int))),
  completion_token_ids: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Int))),
  logprobs: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Number))),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}) {}
