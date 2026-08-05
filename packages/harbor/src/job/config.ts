import { Schema } from "effect";
import {
  AgentConfig,
  ArtifactConfig,
  ArtifactSpec,
  EnvironmentConfig,
  TrialTaskConfig,
  VerifierConfig,
} from "#/trial/config.ts";
import { MetricConfig, UUID } from "#/common/config.ts";
import { withDefault } from "#/common/schema.ts";

export {
  AgentConfig,
  ArtifactConfig,
  ArtifactSpec,
  EnvironmentConfig,
  MetricConfig,
  TrialTaskConfig,
  VerifierConfig,
};

export class DatasetConfig extends Schema.Class<DatasetConfig>("DatasetConfig")({
  path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  version: Schema.optionalKey(Schema.NullOr(Schema.String)),
  ref: Schema.optionalKey(Schema.NullOr(Schema.String)),
  registry_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  registry_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  repo: Schema.optionalKey(Schema.NullOr(Schema.String)),
  overwrite: withDefault(Schema.Boolean, () => false),
  download_dir: Schema.optionalKey(Schema.NullOr(Schema.String)),
  task_names: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  exclude_task_names: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  n_tasks: Schema.optionalKey(Schema.NullOr(Schema.Int)),
}) {}

const defaultExcludedExceptions = [
  "AgentTimeoutError",
  "VerifierTimeoutError",
  "RewardFileNotFoundError",
  "RewardFileEmptyError",
  "VerifierOutputParseError",
  "ApiUsageLimitError",
  "AgentSafetyRefusalError",
  "AgentAuthenticationError",
  "ModelNotFoundError",
];

export class RetryConfig extends Schema.Class<RetryConfig>("RetryConfig")({
  max_retries: withDefault(Schema.Int, () => 0),
  include_exceptions: Schema.optionalKey(Schema.NullOr(Schema.ReadonlySet(Schema.String))),
  exclude_exceptions: withDefault(
    Schema.ReadonlySet(Schema.String),
    () => new Set(defaultExcludedExceptions),
  ),
  wait_multiplier: withDefault(Schema.Number, () => 1),
  min_wait_sec: withDefault(Schema.Number, () => 1),
  max_wait_sec: withDefault(Schema.Number, () => 60),
}) {}

export class SourceJobConfig extends Schema.Class<SourceJobConfig>("SourceJobConfig")({
  action: Schema.Literal("regrade"),
  type: Schema.Literals(["local", "hub"]),
  job_id: Schema.optionalKey(Schema.NullOr(UUID)),
  path: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class JobConfig extends Schema.Class<JobConfig>("JobConfig")({
  job_name: withDefault(Schema.String, () => new Date().toISOString()),
  jobs_dir: withDefault(Schema.String, () => "jobs"),
  n_attempts: withDefault(Schema.Int, () => 1),
  install_only: withDefault(Schema.Boolean, () => false),
  timeout_multiplier: withDefault(Schema.Number, () => 1),
  agent_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  verifier_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  agent_setup_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  environment_build_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  debug: withDefault(Schema.Boolean, () => false),
  n_concurrent_trials: withDefault(Schema.Int, () => 4),
  quiet: withDefault(Schema.Boolean, () => false),
  retry: withDefault(RetryConfig, () => RetryConfig.make({})),
  environment: withDefault(EnvironmentConfig, () => EnvironmentConfig.make({})),
  verifier: withDefault(VerifierConfig, () => VerifierConfig.make({})),
  metrics: withDefault(Schema.Array(MetricConfig), () => new Array<MetricConfig>()),
  agents: withDefault(Schema.Array(AgentConfig), () => [AgentConfig.make({})]),
  datasets: withDefault(Schema.Array(DatasetConfig), () => new Array<DatasetConfig>()),
  tasks: withDefault(Schema.Array(TrialTaskConfig), () => new Array<TrialTaskConfig>()),
  artifacts: withDefault(Schema.Array(ArtifactSpec), () => new Array<ArtifactSpec>()),
  extra_instruction_paths: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  source_jobs: withDefault(Schema.Array(SourceJobConfig), () => new Array<SourceJobConfig>()),
}) {}
