import { Effect, FileSystem, Path, Schema } from "effect";
import { parse } from "smol-toml";
import { Error } from "#/tasks/error.ts";

export const StringMap = Schema.Record(Schema.String, Schema.String);
export const JsonMap = Schema.Record(Schema.String, Schema.Json);

export const NetworkMode = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("no-network"),
  Schema.Literal("allowlist"),
]);
export type NetworkMode = Schema.Schema.Type<typeof NetworkMode>;

export const TaskOS = Schema.Union([Schema.Literal("linux"), Schema.Literal("windows")]);
export type TaskOS = Schema.Schema.Type<typeof TaskOS>;

export const VerifierEnvironmentMode = Schema.Union([
  Schema.Literal("shared"),
  Schema.Literal("separate"),
]);
export type VerifierEnvironmentMode = Schema.Schema.Type<typeof VerifierEnvironmentMode>;

export const MultiStepRewardStrategy = Schema.Union([
  Schema.Literal("mean"),
  Schema.Literal("final"),
]);
export type MultiStepRewardStrategy = Schema.Schema.Type<typeof MultiStepRewardStrategy>;

const User = Schema.Union([Schema.String, Schema.Number]);

export class Author extends Schema.Class<Author>("HarborAuthor")({
  name: Schema.String,
  email: Schema.optional(Schema.String),
}) {}

export class PackageInfo extends Schema.Class<PackageInfo>("HarborPackageInfo")({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  authors: Schema.optional(Schema.Array(Author)),
  keywords: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class AgentConfig extends Schema.Class<AgentConfig>("HarborAgentConfig")({
  timeout_sec: Schema.optional(Schema.Number),
  user: Schema.optional(User),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class HealthcheckConfig extends Schema.Class<HealthcheckConfig>("HarborHealthcheckConfig")({
  command: Schema.String,
  interval_sec: Schema.optional(Schema.Number),
  timeout_sec: Schema.optional(Schema.Number),
  start_period_sec: Schema.optional(Schema.Number),
  start_interval_sec: Schema.optional(Schema.Number),
  retries: Schema.optional(Schema.Number),
}) {}

export class TpuSpec extends Schema.Class<TpuSpec>("HarborTpuSpec")({
  type: Schema.String,
  topology: Schema.String,
}) {}

export class MCPServerConfig extends Schema.Class<MCPServerConfig>("HarborMCPServerConfig")({
  name: Schema.String,
  transport: Schema.optional(
    Schema.Union([
      Schema.Literal("stdio"),
      Schema.Literal("sse"),
      Schema.Literal("streamable-http"),
      Schema.Literal("http"),
    ]),
  ),
  url: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class EnvConfig extends Schema.Class<EnvConfig>("HarborEnvironmentConfig")({
  build_timeout_sec: Schema.optional(Schema.Number),
  docker_image: Schema.optional(Schema.String),
  os: Schema.optional(TaskOS),
  cpus: Schema.optional(Schema.Number),
  memory_mb: Schema.optional(Schema.Number),
  storage_mb: Schema.optional(Schema.Number),
  gpus: Schema.optional(Schema.Number),
  gpu_types: Schema.optional(Schema.Array(Schema.String)),
  tpu: Schema.optional(TpuSpec),
  mcp_servers: Schema.optional(Schema.Array(MCPServerConfig)),
  env: Schema.optional(StringMap),
  skills_dir: Schema.optional(Schema.String),
  workdir: Schema.optional(Schema.String),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
  allow_internet: Schema.optional(Schema.Boolean),
  healthcheck: Schema.optional(HealthcheckConfig),
}) {}

export class VerifierCollectConfig extends Schema.Class<VerifierCollectConfig>(
  "HarborVerifierCollectConfig",
)({
  command: Schema.String,
  service: Schema.optional(Schema.String),
  timeout_sec: Schema.optional(Schema.Number),
  user: Schema.optional(User),
}) {}

export class VerifierConfig extends Schema.Class<VerifierConfig>("HarborVerifierConfig")({
  timeout_sec: Schema.optional(Schema.Number),
  env: Schema.optional(StringMap),
  user: Schema.optional(User),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
  environment_mode: Schema.optional(VerifierEnvironmentMode),
  environment: Schema.optional(EnvConfig),
  collect: Schema.optional(Schema.Array(VerifierCollectConfig)),
}) {}

export class SolutionConfig extends Schema.Class<SolutionConfig>("HarborSolutionConfig")({
  env: Schema.optional(StringMap),
}) {}

export class ArtifactConfig extends Schema.Class<ArtifactConfig>("HarborArtifactConfig")({
  source: Schema.String,
  destination: Schema.optional(Schema.String),
  exclude: Schema.optional(Schema.Array(Schema.String)),
  service: Schema.optional(Schema.String),
}) {}

export const Artifact = Schema.Union([Schema.String, ArtifactConfig]);
export type Artifact = Schema.Schema.Type<typeof Artifact>;

export const MinReward = Schema.Union([Schema.Finite, Schema.Record(Schema.String, Schema.Finite)]);
export type MinReward = Schema.Schema.Type<typeof MinReward>;

export class StepConfig extends Schema.Class<StepConfig>("HarborStepConfig")({
  name: Schema.String,
  agent: Schema.optional(AgentConfig),
  verifier: Schema.optional(VerifierConfig),
  min_reward: Schema.optional(MinReward),
  healthcheck: Schema.optional(HealthcheckConfig),
  artifacts: Schema.optional(Schema.Array(Artifact)),
}) {}

export class TaskConfig extends Schema.Class<TaskConfig>("HarborTaskConfig")({
  schema_version: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  task: Schema.optional(PackageInfo),
  metadata: Schema.optional(JsonMap),
  verifier: Schema.optional(VerifierConfig),
  agent: Schema.optional(AgentConfig),
  environment: Schema.optional(EnvConfig),
  solution: Schema.optional(SolutionConfig),
  source: Schema.optional(Schema.String),
  multi_step_reward_strategy: Schema.optional(MultiStepRewardStrategy),
  steps: Schema.optional(Schema.Array(StepConfig)),
  artifacts: Schema.optional(Schema.Array(Artifact)),
}) {}

export type Metadata = Schema.Schema.Type<typeof JsonMap>;

export const readConfig = Effect.fn("Task.Load.readHarborConfig")(function* (taskDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const toml = yield* fs
    .readFileString(path.join(path.resolve(taskDir), "task.toml"))
    .pipe(Effect.mapError(Error.source));
  const parsed = yield* Effect.try({
    try: () => parse(toml),
    catch: Error.invalid,
  });

  return yield* Schema.decodeUnknownEffect(TaskConfig)(parsed).pipe(Effect.mapError(Error.invalid));
});
