import { Effect, pipe, Schema } from "effect";
import {
  ArtifactManifest,
  AgentContext,
  GitTaskId,
  LocalTaskId,
  PackageTaskId,
  TaskId,
  VerifierResult,
} from "../common/result.ts";
import { UUID, VerifierEnvironmentMode } from "../common/config.ts";
import { TrialConfig } from "./config.ts";

const withDefault = <S extends Schema.Constraint & Schema.WithoutConstructorDefault>(
  schema: S,
  value: () => Schema.Schema.Type<S>,
) =>
  pipe(
    schema,
    Schema.withConstructorDefault(Effect.sync(value)),
    Schema.withDecodingDefaultTypeKey(Effect.sync(value)),
  );

export {
  AgentContext,
  ArtifactManifest,
  GitTaskId,
  LocalTaskId,
  PackageTaskId,
  TaskId,
  VerifierResult,
};

export class TimingInfo extends Schema.Class<TimingInfo>("TimingInfo")({
  started_at: Schema.optionalKey(Schema.NullOr(Schema.DateFromString)),
  finished_at: Schema.optionalKey(Schema.NullOr(Schema.DateFromString)),
}) {}

export class ExceptionInfo extends Schema.Class<ExceptionInfo>("ExceptionInfo")({
  exception_type: Schema.String,
  exception_message: Schema.String,
  exception_traceback: Schema.String,
  occurred_at: Schema.DateFromString,
}) {}

export class ModelInfo extends Schema.Class<ModelInfo>("ModelInfo")({
  name: Schema.String,
  provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class AgentInfo extends Schema.Class<AgentInfo>("AgentInfo")({
  name: Schema.String,
  version: Schema.String,
  model_info: Schema.optionalKey(Schema.NullOr(ModelInfo)),
}) {}

export class StepResult extends Schema.Class<StepResult>("StepResult")({
  step_name: Schema.String,
  agent_result: Schema.optionalKey(Schema.NullOr(AgentContext)),
  verifier_result: Schema.optionalKey(Schema.NullOr(VerifierResult)),
  exception_info: Schema.optionalKey(Schema.NullOr(ExceptionInfo)),
  agent_execution: Schema.optionalKey(Schema.NullOr(TimingInfo)),
  verifier: Schema.optionalKey(Schema.NullOr(TimingInfo)),
}) {}

export class TrialResult extends Schema.Class<TrialResult>("TrialResult")({
  id: withDefault(UUID, () => globalThis.crypto.randomUUID()),
  task_name: Schema.String,
  trial_name: Schema.String,
  trial_uri: Schema.String,
  task_id: TaskId,
  source: Schema.optionalKey(Schema.NullOr(Schema.String)),
  task_checksum: Schema.String,
  config: TrialConfig,
  agent_info: AgentInfo,
  agent_result: Schema.optionalKey(Schema.NullOr(AgentContext)),
  verifier_result: Schema.optionalKey(Schema.NullOr(VerifierResult)),
  verifier_environment_mode: Schema.optionalKey(Schema.NullOr(VerifierEnvironmentMode)),
  exception_info: Schema.optionalKey(Schema.NullOr(ExceptionInfo)),
  started_at: Schema.optionalKey(Schema.NullOr(Schema.DateFromString)),
  finished_at: Schema.optionalKey(Schema.NullOr(Schema.DateFromString)),
  environment_setup: Schema.optionalKey(Schema.NullOr(TimingInfo)),
  agent_setup: Schema.optionalKey(Schema.NullOr(TimingInfo)),
  agent_execution: Schema.optionalKey(Schema.NullOr(TimingInfo)),
  verifier: Schema.optionalKey(Schema.NullOr(TimingInfo)),
  step_results: Schema.optionalKey(Schema.NullOr(Schema.Array(StepResult))),
}) {}
