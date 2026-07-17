import { Effect, FileSystem, Path, Schema } from "effect";
import { parse } from "smol-toml";
import { Error } from "../error.ts";

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

export class Author extends Schema.Class<Author>("Author")({
  name: Schema.String,
  email: Schema.optional(Schema.String),
}) {}

export class PackageInfo extends Schema.Class<PackageInfo>("PackageInfo")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  authors: Schema.optional(Schema.Array(Author)),
  keywords: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class AgentConfig extends Schema.Class<AgentConfig>("AgentConfig")({
  timeout_sec: Schema.optional(Schema.Number),
  user: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class EnvConfig extends Schema.Class<EnvConfig>("EnvConfig")({
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

export class VerifierConfig extends Schema.Class<VerifierConfig>("VerifierConfig")({
  timeout_sec: Schema.optional(Schema.Number),
  env: Schema.optional(StringRecord),
  user: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  network_mode: Schema.optional(NetworkMode),
  allowed_hosts: Schema.optional(Schema.Array(Schema.String)),
  environment_mode: Schema.optional(VerifierEnvironmentMode),
  environment: Schema.optional(EnvConfig),
}) {}

export class SolutionConfig extends Schema.Class<SolutionConfig>("SolutionConfig")({
  env: Schema.optional(StringRecord),
}) {}

const Artifact = Schema.Union([Schema.String, JsonRecord]);

export class TaskConfig extends Schema.Class<TaskConfig>("TaskConfig")({
  schema_version: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  task: Schema.optional(PackageInfo),
  metadata: Schema.optional(JsonRecord),
  verifier: Schema.optional(VerifierConfig),
  agent: Schema.optional(AgentConfig),
  environment: Schema.optional(EnvConfig),
  solution: Schema.optional(SolutionConfig),
  source: Schema.optional(Schema.String),
  multi_step_reward_strategy: Schema.optional(MultiStepRewardStrategy),
  steps: Schema.optional(Schema.Array(Schema.Unknown)),
  artifacts: Schema.optional(Schema.Array(Artifact)),
}) {}

export type Metadata = Schema.Schema.Type<typeof JsonRecord>;

export const readTaskConfig = Effect.fn("Task.Load.readTaskConfig")(function* (taskDir: string) {
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
