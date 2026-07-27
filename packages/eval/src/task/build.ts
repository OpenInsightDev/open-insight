import { Sandbox, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema, Scope } from "effect";
import { castDraft, produce } from "immer";
import { Error } from "./error.ts";
import { StageMetadata } from "./stage.ts";
import type { Stage } from "./stage.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export class BaseMetadata extends Schema.Class<BaseMetadata>("BaseMetadata")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  base: BaseMetadata,
  stages: Schema.Array(StageMetadata),
  extras: Schema.Record(Schema.String, Schema.Json),
}) {}

export type Task<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = Schema.JsonObject,
  S extends Stage = any,
> = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;
  resources: Sandbox.Resources;

  /**
   * Execution stages of the task.
   *
   * Stages are executed sequentially.
   * When executing a stage, the prompt(s) of the stage will be sent to the agent.
   *
   * When all prompts are sent and the agent has finished responding, the grader of the stage will be executed.
   * If the stage grader returns a passing result, the next stage will be executed.
   */
  stages: ReadonlyArray<Stage>;
  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  extras: E;
}> & { _G?: G; _E?: E; _S?: S };

export type Array<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = ReadonlyArray<Task<G, E>>;

export type Options<E extends Schema.JsonObject = EmptyRecord> = BaseMetadataEncoded &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Sandbox.Resources;
    metrics?: ReadonlyArray<Metric.Task.Metric>;
    trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
    extras?: E;
  }>;

const makeMetric = <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Metric.Task.Options<Grade.Result, R>,
) => Metric.Task.make(options).pipe(Effect.mapError(Error.metadata));

const makeTrajMetric = <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Metric.Traj.Options<R>,
) => Metric.Traj.make(options).pipe(Effect.mapError(Error.metadata));

export const make = Effect.fn(function* <E extends Schema.JsonObject = EmptyRecord>(
  options: Options<E>,
): Effect.fn.Return<Task<never, E, never>, Error, Crypto.Crypto | Scope.Scope> {
  const {
    snapshot,
    resources = new Sandbox.Resources(),
    metrics = [],
    trajMetrics = [],
    extras = {} as E,
  } = options;

  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );

  return {
    metadata,
    snapshot,
    resources,
    extras,
    stages: [],
    metrics,
    trajMetrics,
  } satisfies Task<never, E, never>;
});

export const metric =
  <R extends Schema.JsonObject = Schema.JsonObject>(
    exec: Metric.Task.Exec<Grade.Result, R>,
    options: Omit<Metric.Task.Options<Grade.Result, R>, "exec"> = {},
  ) =>
  <G extends Grade.Result, Ex extends Schema.JsonObject, S extends Stage, E, Env>(
    task: Effect.Effect<Task<G, Ex, S>, E, Env>,
  ): Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const metric = yield* makeMetric({ ...options, exec });
          return produce(task, (draft) => {
            draft.metrics.push(castDraft(metric));
          });
        }),
      ),
    );

export const trajMetric =
  <R extends Schema.JsonObject = Schema.JsonObject>(
    exec: Metric.Traj.Exec<R>,
    options: Omit<Metric.Traj.Options<R>, "exec"> = {},
  ) =>
  <G extends Grade.Result, Ex extends Schema.JsonObject, S extends Stage, E, Env>(
    task: Effect.Effect<Task<G, Ex, S>, E, Env>,
  ): Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const metric = yield* makeTrajMetric({ ...options, exec });
          return produce(task, (draft) => {
            draft.trajMetrics.push(castDraft(metric));
          });
        }),
      ),
    );

export const satisfies = <G extends Grade.Result, E extends Schema.JsonObject = EmptyRecord>() =>
  Effect.satisfiesSuccessType<Task<G, E>>();

export const metadata = (task: Task): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: task.extras,
  });
