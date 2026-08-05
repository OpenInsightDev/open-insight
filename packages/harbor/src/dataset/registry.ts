import { Schema } from "effect";
import { MetricConfig } from "#/common/config.ts";
import { withDefault } from "#/common/schema.ts";
import { GitTaskId, LocalTaskId, TaskId } from "#/common/result.ts";

const defaultRegistryUrl =
  "https://raw.githubusercontent.com/laude-institute/harbor/main/registry.json";

export class DatasetSummary extends Schema.Class<DatasetSummary>("DatasetSummary")({
  name: Schema.String,
  version: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: withDefault(Schema.String, () => ""),
  task_count: Schema.Int,
}) {}

export class DatasetFileInfo extends Schema.Class<DatasetFileInfo>("DatasetFileInfo")({
  path: Schema.String,
  storage_path: Schema.String,
  content_hash: Schema.String,
}) {}

export class DatasetMetadata extends Schema.Class<DatasetMetadata>("DatasetMetadata")({
  name: Schema.String,
  version: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: withDefault(Schema.String, () => ""),
  task_ids: Schema.Array(TaskId),
  metrics: withDefault(Schema.Array(MetricConfig), () => new Array<MetricConfig>()),
  files: withDefault(Schema.Array(DatasetFileInfo), () => new Array<DatasetFileInfo>()),
  dataset_version_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  dataset_version_content_hash: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class LocalRegistryInfo extends Schema.Class<LocalRegistryInfo>("LocalRegistryInfo")({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  path: Schema.String,
}) {}

export class RemoteRegistryInfo extends Schema.Class<RemoteRegistryInfo>("RemoteRegistryInfo")({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  url: withDefault(Schema.String, () => defaultRegistryUrl),
}) {}

export class RegistryTaskId extends Schema.Class<RegistryTaskId>("RegistryTaskId")({
  name: Schema.String,
  git_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  git_commit_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  path: Schema.String,
}) {
  toSourceTaskId(): Schema.Schema.Type<typeof TaskId> {
    if (this.git_url === undefined || this.git_url === null) {
      return LocalTaskId.make({ path: this.path });
    }
    if (this.git_commit_id === undefined || this.git_commit_id === null) {
      return GitTaskId.make({ git_url: this.git_url, path: this.path });
    }
    return GitTaskId.make({
      git_url: this.git_url,
      git_commit_id: this.git_commit_id,
      path: this.path,
    });
  }

  getName(): string {
    return this.name;
  }
}

export class DatasetSpec extends Schema.Class<DatasetSpec>("DatasetSpec")({
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  tasks: Schema.Array(RegistryTaskId),
  metrics: withDefault(Schema.Array(MetricConfig), () => new Array<MetricConfig>()),
}) {}

const RegistryFields = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  datasets: Schema.Array(DatasetSpec),
}).check(
  Schema.makeFilter((input) => {
    const hasUrl = input.url !== undefined && input.url !== null;
    const hasPath = input.path !== undefined && input.path !== null;
    return hasUrl === hasPath ? "registry must provide exactly one of url or path" : undefined;
  }),
);

export class Registry extends Schema.Class<Registry>("Registry")(RegistryFields) {}

export { defaultRegistryUrl as DefaultRegistryUrl };
