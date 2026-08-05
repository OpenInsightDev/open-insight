import { Effect, pipe, Schema } from "effect";

const withDefault = <S extends Schema.Constraint & Schema.WithoutConstructorDefault>(
  schema: S,
  value: () => Schema.Schema.Type<S>,
) =>
  pipe(
    schema,
    Schema.withConstructorDefault(Effect.sync(value)),
    Schema.withDecodingDefaultTypeKey(Effect.sync(value)),
  );

export class LocalTaskId extends Schema.Class<LocalTaskId>("LocalTaskId")({
  path: Schema.String,
}) {}

export class GitTaskId extends Schema.Class<GitTaskId>("GitTaskId")({
  git_url: Schema.String,
  git_commit_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  path: Schema.String,
}) {}

export class PackageTaskId extends Schema.Class<PackageTaskId>("PackageTaskId")({
  org: Schema.String,
  name: Schema.String,
  ref: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export const TaskId = Schema.Union([GitTaskId, PackageTaskId, LocalTaskId]);
export type TaskId = Schema.Schema.Type<typeof TaskId>;

export class RolloutDetail extends Schema.Class<RolloutDetail>("RolloutDetail")({
  prompt_token_ids: Schema.optionalKey(Schema.Array(Schema.Array(Schema.Int))),
  completion_token_ids: Schema.optionalKey(Schema.Array(Schema.Array(Schema.Int))),
  logprobs: Schema.optionalKey(Schema.Array(Schema.Array(Schema.Number))),
  extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Json))),
}) {}

export class AgentContext extends Schema.Class<AgentContext>("AgentContext")({
  n_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  n_cache_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  n_output_tokens: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  cost_usd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  rollout_details: Schema.optionalKey(Schema.NullOr(Schema.Array(RolloutDetail))),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Json))),
}) {}

export class VerifierResult extends Schema.Class<VerifierResult>("VerifierResult")({
  rewards: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Number))),
}) {}

export class ArtifactManifestEntry extends Schema.Class<ArtifactManifestEntry>(
  "ArtifactManifestEntry",
)({
  source: Schema.String,
  destination: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  status: Schema.Literals(["ok", "failed", "empty", "skipped"]),
  service: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class ArtifactManifest extends Schema.Class<ArtifactManifest>("ArtifactManifest")({
  entries: withDefault(
    Schema.Array(ArtifactManifestEntry),
    () => new Array<ArtifactManifestEntry>(),
  ),
}) {}
