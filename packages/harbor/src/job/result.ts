import { Schema } from "effect";
import { UUID } from "#/common/config.ts";
import { withDefault } from "#/common/schema.ts";
import { AgentContext, VerifierResult } from "#/common/result.ts";
import { TrialResult } from "#/trial/result.ts";

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const StringNumberMap = Schema.Record(Schema.String, Schema.Number);
const RewardStats = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);

export class AgentDatasetStats extends Schema.Class<AgentDatasetStats>("AgentDatasetStats")({
  n_trials: withDefault(Schema.Int, () => 0),
  n_errors: withDefault(Schema.Int, () => 0),
  metrics: withDefault(
    Schema.Array(JsonObject),
    () => new Array<Schema.Schema.Type<typeof JsonObject>>(),
  ),
  pass_at_k: withDefault(StringNumberMap, () => ({})),
  reward_stats: withDefault(RewardStats, () => ({})),
  exception_stats: withDefault(
    Schema.Record(Schema.String, Schema.Array(Schema.String)),
    () => ({}),
  ),
}) {}

export class JobStats extends Schema.Class<JobStats>("JobStats")({
  n_completed_trials: withDefault(Schema.Int, () => 0),
  n_errored_trials: withDefault(Schema.Int, () => 0),
  n_running_trials: withDefault(Schema.Int, () => 0),
  n_pending_trials: withDefault(Schema.Int, () => 0),
  n_cancelled_trials: withDefault(Schema.Int, () => 0),
  n_retries: withDefault(Schema.Int, () => 0),
  evals: withDefault(Schema.Record(Schema.String, AgentDatasetStats), () => ({})),
  n_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  n_cache_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  n_output_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  cost_usd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
}) {}

export class JobResult extends Schema.Class<JobResult>("JobResult")({
  id: UUID,
  started_at: Schema.DateFromString,
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.DateFromString)),
  finished_at: Schema.optionalKey(Schema.NullOr(Schema.DateFromString)),
  n_total_trials: Schema.Int,
  stats: JobStats,
  trial_results: withDefault(Schema.Array(TrialResult), () => new Array<TrialResult>()),
}) {}

export { AgentContext, TrialResult, VerifierResult };
