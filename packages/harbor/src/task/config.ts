import { Schema } from "effect";
import {
  ArtifactConfig,
  ArtifactSpec,
  HealthcheckConfig,
  MultiStepRewardStrategy,
  PackageInfo,
  SolutionConfig,
  TaskAgentConfig,
  TaskEnvironmentConfig,
  TaskVerifierConfig,
} from "#/common/config.ts";
import { withDefault } from "#/common/schema.ts";

export {
  ArtifactConfig,
  ArtifactSpec,
  MultiStepRewardStrategy,
  PackageInfo,
  SolutionConfig,
  TaskAgentConfig,
  TaskEnvironmentConfig,
  TaskVerifierConfig,
};

export class StepConfig extends Schema.Class<StepConfig>("StepConfig")({
  name: Schema.String,
  agent: withDefault(TaskAgentConfig, () => TaskAgentConfig.make({})),
  verifier: withDefault(TaskVerifierConfig, () => TaskVerifierConfig.make({})),
  min_reward: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.Number, Schema.Record(Schema.String, Schema.Number)])),
  ),
  healthcheck: Schema.optionalKey(Schema.NullOr(HealthcheckConfig)),
  artifacts: withDefault(Schema.Array(ArtifactSpec), () => new Array<ArtifactSpec>()),
}) {}

export class TaskConfig extends Schema.Class<TaskConfig>("TaskConfig")({
  schema_version: withDefault(Schema.String, () => "1.4"),
  task: Schema.optionalKey(Schema.NullOr(PackageInfo)),
  metadata: withDefault(Schema.Record(Schema.String, Schema.Json), () => ({})),
  verifier: withDefault(TaskVerifierConfig, () => TaskVerifierConfig.make({})),
  agent: withDefault(TaskAgentConfig, () => TaskAgentConfig.make({})),
  environment: withDefault(TaskEnvironmentConfig, () => TaskEnvironmentConfig.make({})),
  solution: withDefault(SolutionConfig, () => SolutionConfig.make({})),
  source: Schema.optionalKey(Schema.NullOr(Schema.String)),
  multi_step_reward_strategy: Schema.optionalKey(Schema.NullOr(MultiStepRewardStrategy)),
  steps: Schema.optionalKey(Schema.NullOr(Schema.Array(StepConfig))),
  artifacts: withDefault(Schema.Array(ArtifactSpec), () => new Array<ArtifactSpec>()),
}) {}
