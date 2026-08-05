import { Schema } from "effect";
import { withDefault } from "./schema.ts";

export const UUID = Schema.String.check(Schema.isUUID());
export const JsonRecord = Schema.Record(Schema.String, Schema.Json);
export const StringRecord = Schema.Record(Schema.String, Schema.String);
export const UserOrUid = Schema.Union([Schema.String, Schema.Int]);

export const NetworkMode = Schema.Literals(["public", "no-network", "allowlist"]);
export type NetworkMode = Schema.Schema.Type<typeof NetworkMode>;

export const TaskOS = Schema.Literals(["linux", "windows"]);
export type TaskOS = Schema.Schema.Type<typeof TaskOS>;

export const ResourceMode = Schema.Literals(["auto", "limit", "request", "guarantee", "ignore"]);
export type ResourceMode = Schema.Schema.Type<typeof ResourceMode>;

export const VerifierEnvironmentMode = Schema.Literals(["shared", "separate"]);
export type VerifierEnvironmentMode = Schema.Schema.Type<typeof VerifierEnvironmentMode>;

export const MCPTransport = Schema.Literals(["stdio", "sse", "streamable-http"]);
export type MCPTransport = Schema.Schema.Type<typeof MCPTransport>;

export const MetricType = Schema.Literals(["sum", "min", "max", "mean", "uv-script"]);
export type MetricType = Schema.Schema.Type<typeof MetricType>;

export const MultiStepRewardStrategy = Schema.Literals(["mean", "final"]);
export type MultiStepRewardStrategy = Schema.Schema.Type<typeof MultiStepRewardStrategy>;

const defaultMcpTransport: MCPTransport = "sse";
const defaultNetworkMode: NetworkMode = "public";
const defaultTaskOS: TaskOS = "linux";

export class MetricConfig extends Schema.Class<MetricConfig>("MetricConfig")({
  type: MetricType,
  kwargs: withDefault(JsonRecord, () => ({})),
}) {}

export class TpuSpec extends Schema.Class<TpuSpec>("TpuSpec")({
  type: Schema.NonEmptyString,
  topology: Schema.String.check(Schema.isPattern(/^[1-9]\d*(x[1-9]\d*)+$/)),
}) {}

export class HealthcheckConfig extends Schema.Class<HealthcheckConfig>("HealthcheckConfig")({
  command: Schema.String,
  interval_sec: withDefault(Schema.Number, () => 5),
  timeout_sec: withDefault(Schema.Number, () => 30),
  start_period_sec: withDefault(Schema.Number, () => 0),
  start_interval_sec: withDefault(Schema.Number, () => 5),
  retries: withDefault(Schema.Int, () => 3),
}) {}

export class MCPServerConfig extends Schema.Class<MCPServerConfig>("MCPServerConfig")({
  name: Schema.String,
  transport: withDefault(MCPTransport, () => defaultMcpTransport),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  args: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
}) {}

export class ServiceVolumeBind extends Schema.Class<ServiceVolumeBind>("ServiceVolumeBind")({
  create_host_path: Schema.optionalKey(Schema.Literal(false)),
}) {}

export class ServiceVolumeVolume extends Schema.Class<ServiceVolumeVolume>("ServiceVolumeVolume")({
  subpath: Schema.optionalKey(Schema.String),
}) {}

export class ServiceVolumeImage extends Schema.Class<ServiceVolumeImage>("ServiceVolumeImage")({
  subpath: Schema.optionalKey(Schema.String),
}) {}

export class ServiceVolumeConfig extends Schema.Class<ServiceVolumeConfig>("ServiceVolumeConfig")({
  type: Schema.Literals(["bind", "volume", "image"]),
  source: Schema.String,
  target: Schema.String,
  read_only: Schema.optionalKey(Schema.Literal(true)),
  bind: Schema.optionalKey(ServiceVolumeBind),
  volume: Schema.optionalKey(ServiceVolumeVolume),
  image: Schema.optionalKey(ServiceVolumeImage),
}) {}

export class ArtifactConfig extends Schema.Class<ArtifactConfig>("ArtifactConfig")({
  source: Schema.String,
  destination: Schema.optionalKey(Schema.NullOr(Schema.String)),
  exclude: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
  service: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export const ArtifactSpec = Schema.Union([Schema.String, ArtifactConfig]);
export type ArtifactSpec = Schema.Schema.Type<typeof ArtifactSpec>;

export class VerifierCollectConfig extends Schema.Class<VerifierCollectConfig>(
  "VerifierCollectConfig",
)({
  command: Schema.String,
  service: withDefault(Schema.String, () => "main"),
  timeout_sec: withDefault(Schema.Number, () => 60),
  user: Schema.optionalKey(Schema.NullOr(UserOrUid)),
}) {}

export class TaskAgentConfig extends Schema.Class<TaskAgentConfig>("TaskAgentConfig")({
  timeout_sec: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  user: Schema.optionalKey(Schema.NullOr(UserOrUid)),
  network_mode: Schema.optionalKey(Schema.NullOr(NetworkMode)),
  allowed_hosts: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
}) {}

export class TaskEnvironmentConfig extends Schema.Class<TaskEnvironmentConfig>(
  "TaskEnvironmentConfig",
)({
  network_mode: withDefault(NetworkMode, () => defaultNetworkMode),
  allowed_hosts: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  build_timeout_sec: withDefault(Schema.Number, () => 600),
  docker_image: Schema.optionalKey(Schema.NullOr(Schema.String)),
  os: withDefault(TaskOS, () => defaultTaskOS),
  cpus: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  memory_mb: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  storage_mb: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  gpus: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  gpu_types: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  tpu: Schema.optionalKey(Schema.NullOr(TpuSpec)),
  mcp_servers: withDefault(Schema.Array(MCPServerConfig), () => new Array<MCPServerConfig>()),
  env: withDefault(StringRecord, () => ({})),
  skills_dir: Schema.optionalKey(Schema.NullOr(Schema.String)),
  healthcheck: Schema.optionalKey(Schema.NullOr(HealthcheckConfig)),
  workdir: Schema.optionalKey(Schema.NullOr(Schema.String)),
  allow_internet: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
}) {}

export class TaskVerifierConfig extends Schema.Class<TaskVerifierConfig>("TaskVerifierConfig")({
  timeout_sec: withDefault(Schema.Number, () => 600),
  env: withDefault(StringRecord, () => ({})),
  user: Schema.optionalKey(Schema.NullOr(UserOrUid)),
  network_mode: Schema.optionalKey(Schema.NullOr(NetworkMode)),
  allowed_hosts: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  environment_mode: Schema.optionalKey(Schema.NullOr(VerifierEnvironmentMode)),
  environment: Schema.optionalKey(Schema.NullOr(TaskEnvironmentConfig)),
  collect: withDefault(
    Schema.Array(VerifierCollectConfig),
    () => new Array<VerifierCollectConfig>(),
  ),
}) {}

export class Author extends Schema.Class<Author>("Author")({
  name: Schema.String,
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class PackageInfo extends Schema.Class<PackageInfo>("PackageInfo")({
  name: Schema.String,
  version: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: withDefault(Schema.String, () => ""),
  authors: withDefault(Schema.Array(Author), () => new Array<Author>()),
  keywords: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
}) {}

export class SolutionConfig extends Schema.Class<SolutionConfig>("SolutionConfig")({
  env: withDefault(StringRecord, () => ({})),
}) {}
