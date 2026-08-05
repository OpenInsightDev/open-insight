import { Schema } from "effect";
import {
  ArtifactConfig,
  ArtifactSpec,
  JsonRecord,
  MCPServerConfig,
  ResourceMode,
  ServiceVolumeConfig,
  StringRecord,
  TaskOS,
  TpuSpec,
  UUID,
  VerifierEnvironmentMode,
} from "#/common/config.ts";
import { withDefault } from "#/common/schema.ts";

export { ArtifactConfig, ArtifactSpec, ResourceMode, TaskOS, TpuSpec, VerifierEnvironmentMode };

const defaultResourceMode: ResourceMode = "auto";

export class AgentConfig extends Schema.Class<AgentConfig>("AgentConfig")({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  import_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  n_concurrent: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  concurrency_group: Schema.optionalKey(Schema.NullOr(Schema.String)),
  skills: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  override_timeout_sec: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  override_setup_timeout_sec: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  max_timeout_sec: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  resume_trajectory: withDefault(Schema.Boolean, () => false),
  load_trajectory: Schema.optionalKey(Schema.NullOr(Schema.String)),
  extra_allowed_hosts: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  include_logs: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  exclude_logs: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  kwargs: withDefault(JsonRecord, () => ({})),
  env: withDefault(StringRecord, () => ({})),
  mcp_servers: withDefault(Schema.Array(MCPServerConfig), () => new Array<MCPServerConfig>()),
}) {}

export class EnvironmentConfig extends Schema.Class<EnvironmentConfig>("EnvironmentConfig")({
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  import_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  force_build: withDefault(Schema.Boolean, () => false),
  delete: withDefault(Schema.Boolean, () => true),
  cpu_enforcement_policy: withDefault(ResourceMode, () => defaultResourceMode),
  memory_enforcement_policy: withDefault(ResourceMode, () => defaultResourceMode),
  override_cpus: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  override_memory_mb: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  override_storage_mb: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  override_gpus: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  override_tpu: Schema.optionalKey(Schema.NullOr(TpuSpec)),
  suppress_override_warnings: withDefault(Schema.Boolean, () => false),
  mounts: Schema.optionalKey(Schema.NullOr(Schema.Array(ServiceVolumeConfig))),
  extra_docker_compose: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  env: withDefault(StringRecord, () => ({})),
  kwargs: withDefault(JsonRecord, () => ({})),
  extra_allowed_hosts: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
}) {}

export class VerifierConfig extends Schema.Class<VerifierConfig>("VerifierConfig")({
  override_timeout_sec: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  max_timeout_sec: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  include_logs: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  exclude_logs: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  env: withDefault(StringRecord, () => ({})),
  import_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  kwargs: withDefault(JsonRecord, () => ({})),
  disable: withDefault(Schema.Boolean, () => false),
}) {}

export class SourceTrialConfig extends Schema.Class<SourceTrialConfig>("SourceTrialConfig")({
  action: Schema.Literal("regrade"),
  type: Schema.Literals(["local", "hub"]),
  trial_id: Schema.optionalKey(Schema.NullOr(UUID)),
  path: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class TrialTaskConfig extends Schema.Class<TrialTaskConfig>("TrialTaskConfig")({
  path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  git_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  git_commit_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  ref: Schema.optionalKey(Schema.NullOr(Schema.String)),
  overwrite: withDefault(Schema.Boolean, () => false),
  download_dir: Schema.optionalKey(Schema.NullOr(Schema.String)),
  source: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export { TrialTaskConfig as TaskReferenceConfig };

export class TrialConfig extends Schema.Class<TrialConfig>("TrialConfig")({
  task: TrialTaskConfig,
  trial_name: withDefault(Schema.String, () => ""),
  trials_dir: withDefault(Schema.String, () => "trials"),
  install_only: withDefault(Schema.Boolean, () => false),
  timeout_multiplier: withDefault(Schema.Number, () => 1),
  agent_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  verifier_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  agent_setup_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  environment_build_timeout_multiplier: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  agent: withDefault(AgentConfig, () => AgentConfig.make({})),
  environment: withDefault(EnvironmentConfig, () => EnvironmentConfig.make({})),
  verifier: withDefault(VerifierConfig, () => VerifierConfig.make({})),
  artifacts: withDefault(Schema.Array(ArtifactSpec), () => new Array<ArtifactSpec>()),
  extra_instruction_paths: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  job_id: Schema.optionalKey(Schema.NullOr(UUID)),
  source_trial: Schema.optionalKey(Schema.NullOr(SourceTrialConfig)),
}) {}
