import { Effect, FileSystem, Path, Schema } from "effect";
import { parse } from "smol-toml";
import { TaskError } from "#/task/error.ts";

const StringRecord = Schema.Record(Schema.String, Schema.String);
const JsonRecord = Schema.Record(Schema.String, Schema.Json);
const NetworkMode = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("no-network"),
  Schema.Literal("allowlist"),
]);
const TaskOS = Schema.Union([Schema.Literal("linux"), Schema.Literal("windows")]);
const VerifierEnvironmentMode = Schema.Union([
  Schema.Literal("shared"),
  Schema.Literal("separate"),
]);
const MultiStepRewardStrategy = Schema.Union([Schema.Literal("mean"), Schema.Literal("final")]);

export class HarborAuthor extends Schema.Class<HarborAuthor>("HarborAuthor")({
  name: Schema.String,
  email: Schema.optional(Schema.String),
}) {}

export class HarborPackageInfo extends Schema.Class<HarborPackageInfo>("HarborPackageInfo")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  authors: Schema.optional(Schema.Array(HarborAuthor)),
  keywords: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class HarborAgentConfig extends Schema.Class<HarborAgentConfig>("HarborAgentConfig")({
  timeout_sec: Schema.optional(Schema.Number),
  user: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class HarborEnvironmentConfig extends Schema.Class<HarborEnvironmentConfig>(
  "HarborEnvironmentConfig",
)({
  build_timeout_sec: Schema.optional(Schema.Number),
  docker_image: Schema.optional(Schema.String),
  os: Schema.optional(TaskOS),
  cpus: Schema.optional(Schema.Number),
  memory_mb: Schema.optional(Schema.Number),
  storage_mb: Schema.optional(Schema.Number),
  gpus: Schema.optional(Schema.Number),
  gpu_types: Schema.optional(Schema.Array(Schema.String)),
  mcp_servers: Schema.optional(Schema.Array(JsonRecord)),
  env: Schema.optional(StringRecord),
  skills_dir: Schema.optional(Schema.String),
  workdir: Schema.optional(Schema.String),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
  allow_internet: Schema.optional(Schema.Boolean),
  healthcheck: Schema.optional(JsonRecord),
}) {}

export class HarborVerifierConfig extends Schema.Class<HarborVerifierConfig>(
  "HarborVerifierConfig",
)({
  timeout_sec: Schema.optional(Schema.Number),
  env: Schema.optional(StringRecord),
  user: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
  environment_mode: Schema.optional(VerifierEnvironmentMode),
  environment: Schema.optional(HarborEnvironmentConfig),
}) {}

export class HarborSolutionConfig extends Schema.Class<HarborSolutionConfig>(
  "HarborSolutionConfig",
)({
  env: Schema.optional(StringRecord),
}) {}

const HarborArtifact = Schema.Union([Schema.String, JsonRecord]);

export class HarborTaskConfig extends Schema.Class<HarborTaskConfig>("HarborTaskConfig")({
  schema_version: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  task: Schema.optional(HarborPackageInfo),
  metadata: Schema.optional(JsonRecord),
  verifier: Schema.optional(HarborVerifierConfig),
  agent: Schema.optional(HarborAgentConfig),
  environment: Schema.optional(HarborEnvironmentConfig),
  solution: Schema.optional(HarborSolutionConfig),
  source: Schema.optional(Schema.String),
  multi_step_reward_strategy: Schema.optional(MultiStepRewardStrategy),
  steps: Schema.optional(Schema.Array(Schema.Unknown)),
  artifacts: Schema.optional(Schema.Array(HarborArtifact)),
}) {}

export type HarborMetadata = Schema.Schema.Type<typeof JsonRecord>;

export const readHarborTaskConfig = Effect.fn("Task.Load.readHarborTaskConfig")(function* (
  taskDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const toml = yield* fs
    .readFileString(path.join(path.resolve(taskDir), "task.toml"))
    .pipe(Effect.mapError(TaskError.load));
  const parsed = yield* Effect.try({
    try: () => parse(toml),
    catch: TaskError.load,
  });

  return yield* Schema.decodeUnknownEffect(HarborTaskConfig)(parsed).pipe(
    Effect.mapError(TaskError.load),
  );
});
