import { Schema } from "effect";
import { JsonRecord } from "#/common/config.ts";

export class FinalMetrics extends Schema.Class<FinalMetrics>("FinalMetrics")({
  total_prompt_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  total_completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  total_cached_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  total_cost_usd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  total_steps: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}) {}
