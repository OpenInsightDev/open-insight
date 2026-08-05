import { Effect, pipe, Schema } from "effect";
import { JsonRecord } from "../common/config.ts";
import { Agent } from "./agent.ts";
import { FinalMetrics } from "./final-metrics.ts";
import { Step } from "./step.ts";

export const TrajectorySchemaVersion = Schema.Literals([
  "ATIF-v1.0",
  "ATIF-v1.1",
  "ATIF-v1.2",
  "ATIF-v1.3",
  "ATIF-v1.4",
  "ATIF-v1.5",
  "ATIF-v1.6",
  "ATIF-v1.7",
]);
export type TrajectorySchemaVersion = Schema.Schema.Type<typeof TrajectorySchemaVersion>;
const defaultTrajectorySchemaVersion: TrajectorySchemaVersion = "ATIF-v1.7";

const withDefault = <S extends Schema.Constraint & Schema.WithoutConstructorDefault>(
  schema: S,
  value: () => Schema.Schema.Type<S>,
) =>
  pipe(
    schema,
    Schema.withConstructorDefault(Effect.sync(value)),
    Schema.withDecodingDefaultTypeKey(Effect.sync(value)),
  );

export interface Trajectory {
  readonly schema_version?: TrajectorySchemaVersion;
  readonly session_id?: string | null;
  readonly trajectory_id?: string | null;
  readonly agent: Schema.Schema.Type<typeof Agent>;
  readonly steps: ReadonlyArray<Schema.Schema.Type<typeof Step>>;
  readonly notes?: string | null;
  readonly final_metrics?: Schema.Schema.Type<typeof FinalMetrics> | null;
  readonly continued_trajectory_ref?: string | null;
  readonly extra?: Schema.Schema.Type<typeof JsonRecord> | null;
  readonly subagent_trajectories?: ReadonlyArray<Trajectory> | null;
}

const EmbeddedTrajectory = Schema.suspend(
  (): Schema.Codec<Trajectory, unknown, never, never> => Trajectory,
);

const TrajectorySchema = Schema.Struct({
  schema_version: withDefault(TrajectorySchemaVersion, () => defaultTrajectorySchemaVersion),
  session_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  trajectory_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  agent: Agent,
  steps: Schema.Array(Step).check(Schema.isMinLength(1)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  final_metrics: Schema.optionalKey(Schema.NullOr(FinalMetrics)),
  continued_trajectory_ref: Schema.optionalKey(Schema.NullOr(Schema.String)),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
  subagent_trajectories: Schema.optionalKey(Schema.NullOr(Schema.Array(EmbeddedTrajectory))),
}).check(
  Schema.makeFilter((input) => {
    for (const [index, step] of input.steps.entries()) {
      const expectedStepId = index + 1;
      if (step.step_id !== expectedStepId) {
        return `steps[${index}].step_id must be ${expectedStepId}`;
      }
    }

    if (input.subagent_trajectories !== undefined && input.subagent_trajectories !== null) {
      const trajectoryIds = new Set<string>();
      for (const [index, subagent] of input.subagent_trajectories.entries()) {
        if (subagent.trajectory_id === undefined || subagent.trajectory_id === null) {
          return `subagent_trajectories[${index}].trajectory_id is required`;
        }
        if (trajectoryIds.has(subagent.trajectory_id)) {
          return `subagent_trajectories[${index}].trajectory_id must be unique`;
        }
        trajectoryIds.add(subagent.trajectory_id);
      }
    }

    for (const step of input.steps) {
      if (step.observation === undefined || step.observation === null) {
        continue;
      }
      const toolCallIds = new Set((step.tool_calls ?? []).map((toolCall) => toolCall.tool_call_id));
      for (const result of step.observation.results) {
        if (
          result.source_call_id !== undefined &&
          result.source_call_id !== null &&
          !toolCallIds.has(result.source_call_id)
        ) {
          return `observation references unknown tool_call_id '${result.source_call_id}'`;
        }
      }
    }

    return undefined;
  }),
);

export const Trajectory: Schema.Codec<Trajectory, unknown, never, never> =
  TrajectorySchema.annotate({
    identifier: "Trajectory",
  });

export const hasMultimodalContent = (trajectory: Trajectory): boolean =>
  trajectory.steps.some((step) => {
    if (Array.isArray(step.message) && step.message.some((part) => part.type === "image")) {
      return true;
    }

    return (
      step.observation !== undefined &&
      step.observation !== null &&
      step.observation.results.some(
        (result) =>
          Array.isArray(result.content) && result.content.some((part) => part.type === "image"),
      )
    );
  });
