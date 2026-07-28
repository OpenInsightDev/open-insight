import { Effect, Schema } from "effect";
import { VerifierEnvironmentMode } from "./config.ts";

const Timestamp = Schema.DateTimeUtcFromString;
const UUID = Schema.String.check(Schema.isUUID());
const JsonObject = Schema.Record(Schema.String, Schema.Json);
const Rewards = Schema.Record(Schema.String, Schema.Finite);

const Count = Schema.Int.pipe(
  Schema.withConstructorDefault(Effect.succeed(0)),
  Schema.withDecodingDefaultType(Effect.succeed(0)),
);

export class TimingInfo extends Schema.Class<TimingInfo>("HarborTimingInfo")({
  started_at: Schema.NullOr(Timestamp),
  finished_at: Schema.NullOr(Timestamp),
}) {}

export class ExceptionInfo extends Schema.Class<ExceptionInfo>("HarborExceptionInfo")({
  exception_type: Schema.String,
  exception_message: Schema.String,
  exception_traceback: Schema.String,
  occurred_at: Timestamp,
}) {}

export class ModelInfo extends Schema.Class<ModelInfo>("HarborModelInfo")({
  name: Schema.String,
  provider: Schema.NullOr(Schema.String),
}) {}

export class AgentInfo extends Schema.Class<AgentInfo>("HarborAgentInfo")({
  name: Schema.String,
  version: Schema.String,
  model_info: Schema.NullOr(ModelInfo),
}) {}

export class AgentContext extends Schema.Class<AgentContext>("HarborAgentContext")({
  n_input_tokens: Schema.NullOr(Schema.Int),
  n_cache_tokens: Schema.NullOr(Schema.Int),
  n_output_tokens: Schema.NullOr(Schema.Int),
  cost_usd: Schema.NullOr(Schema.Finite),
  rollout_details: Schema.NullOr(Schema.Array(JsonObject)),
  metadata: Schema.NullOr(JsonObject),
}) {}

export class VerifierResult extends Schema.Class<VerifierResult>("HarborVerifierResult")({
  rewards: Schema.NullOr(Rewards),
}) {}

export class StepResult extends Schema.Class<StepResult>("HarborStepResult")({
  step_name: Schema.String,
  agent_result: Schema.NullOr(AgentContext),
  verifier_result: Schema.NullOr(VerifierResult),
  exception_info: Schema.NullOr(ExceptionInfo),
  agent_execution: Schema.NullOr(TimingInfo),
  verifier: Schema.NullOr(TimingInfo),
}) {}

/** Schema for Harbor's Python `TrialResult` model. */
export class TrailResult extends Schema.Class<TrailResult>("HarborTrailResult")({
  id: UUID,
  task_name: Schema.String,
  trial_name: Schema.String,
  trial_uri: Schema.String,
  task_id: JsonObject,
  source: Schema.NullOr(Schema.String),
  task_checksum: Schema.String,
  config: JsonObject,
  agent_info: AgentInfo,
  agent_result: Schema.NullOr(AgentContext),
  verifier_result: Schema.NullOr(VerifierResult),
  verifier_environment_mode: Schema.NullOr(VerifierEnvironmentMode),
  exception_info: Schema.NullOr(ExceptionInfo),
  started_at: Schema.NullOr(Timestamp),
  finished_at: Schema.NullOr(Timestamp),
  environment_setup: Schema.NullOr(TimingInfo),
  agent_setup: Schema.NullOr(TimingInfo),
  agent_execution: Schema.NullOr(TimingInfo),
  verifier: Schema.NullOr(TimingInfo),
  step_results: Schema.NullOr(Schema.Array(StepResult)),
}) {}

export class AgentDatasetStats extends Schema.Class<AgentDatasetStats>("HarborAgentDatasetStats")({
  n_trials: Count,
  n_errors: Count,
  metrics: Schema.Array(JsonObject).pipe(
    Schema.withConstructorDefault(Effect.succeed([])),
    Schema.withDecodingDefaultType(Effect.succeed([])),
  ),
  pass_at_k: Schema.Record(Schema.String, Schema.Finite).pipe(
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultType(Effect.succeed({})),
  ),
  reward_stats: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, Schema.Array(Schema.String)),
  ).pipe(
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultType(Effect.succeed({})),
  ),
  exception_stats: Schema.Record(Schema.String, Schema.Array(Schema.String)).pipe(
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultType(Effect.succeed({})),
  ),
}) {}

export class JobStats extends Schema.Class<JobStats>("HarborJobStats")({
  n_completed_trials: Count,
  n_errored_trials: Count,
  n_running_trials: Count,
  n_pending_trials: Count,
  n_cancelled_trials: Count,
  n_retries: Count,
  evals: Schema.Record(Schema.String, AgentDatasetStats).pipe(
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultType(Effect.succeed({})),
  ),
  n_input_tokens: Schema.NullOr(Schema.Int),
  n_cache_tokens: Schema.NullOr(Schema.Int),
  n_output_tokens: Schema.NullOr(Schema.Int),
  cost_usd: Schema.NullOr(Schema.Finite),
}) {}

export class JobResult extends Schema.Class<JobResult>("HarborJobResult")({
  id: UUID,
  started_at: Timestamp,
  updated_at: Schema.NullOr(Timestamp),
  finished_at: Schema.NullOr(Timestamp),
  n_total_trials: Schema.Int,
  stats: JobStats,
  trial_results: Schema.Array(TrailResult).pipe(
    Schema.withConstructorDefault(Effect.succeed([])),
    Schema.withDecodingDefaultType(Effect.succeed([])),
  ),
}) {}
