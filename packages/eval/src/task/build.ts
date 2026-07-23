import { Sandbox, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import * as TaskMetric from "#/metric/task.ts";
import * as TrajMetric from "#/metric/traj.ts";
import { Crypto, Effect, Schema, Scope } from "effect";
import { castDraft, produce } from "immer";
import { Error } from "./error.ts";
import { stage, StageMetadata } from "./stage.ts";
import type { Stage } from "./stage.ts";
import { Prompt } from "@open-insight/core";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export type ID = string;

export class BaseMetadata extends Schema.Class<BaseMetadata>("BaseMetadata")({
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
  G extends Grade.Result = never,
  E extends Schema.JsonObject = EmptyRecord,
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
  metrics: ReadonlyArray<TaskMetric.Metric>;
  trajMetrics: ReadonlyArray<TrajMetric.Metric>;

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
    metrics?: ReadonlyArray<TaskMetric.Options>;
    trajMetrics?: ReadonlyArray<TrajMetric.Options>;
    extras?: E;
    [Symbol.asyncDispose]?: () => PromiseLike<void>;
  }>;

const makeMetric = (options: TaskMetric.Options) =>
  TaskMetric.make(options).pipe(Effect.mapError(Error.metadata));

const makeTrajMetric = (options: TrajMetric.Options) =>
  TrajMetric.make(options).pipe(Effect.mapError(Error.metadata));

export const make = Effect.fn(function* <E extends Schema.JsonObject = EmptyRecord>(
  options: Options<E>,
): Effect.fn.Return<Task<never, E, never>, Error, Crypto.Crypto | Scope.Scope> {
  const {
    snapshot,
    resources = new Sandbox.Resources(),
    metrics: metricOptions = [],
    trajMetrics: trajMetricOptions = [],
    extras = {} as E,
    [Symbol.asyncDispose]: dispose,
  } = options;

  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  const [metrics, trajMetrics] = yield* Effect.all([
    Effect.all(metricOptions.map(makeMetric)),
    Effect.all(trajMetricOptions.map(makeTrajMetric)),
  ]);

  yield* Effect.addFinalizer(() =>
    Effect.tryPromise(async () => {
      await dispose?.();
    }),
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
  (id: string, options: Omit<TaskMetric.Options, "id">) =>
  <G extends Grade.Result, Ex extends Schema.JsonObject, S extends Stage, E, Env>(
    task: Effect.Effect<Task<G, Ex, S>, E, Env>,
  ): Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto> =>
    Effect.all([task, makeMetric({ ...options, id })]).pipe(
      Effect.map(([task, metric]) =>
        produce(task, (draft) => {
          draft.metrics.push(castDraft(metric));
        }),
      ),
    );

export const trajMetric =
  (id: string, options: Omit<TrajMetric.Options, "id">) =>
  <G extends Grade.Result, Ex extends Schema.JsonObject, S extends Stage, E, Env>(
    task: Effect.Effect<Task<G, Ex, S>, E, Env>,
  ): Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto> =>
    Effect.all([task, makeTrajMetric({ ...options, id })]).pipe(
      Effect.map(([task, metric]) =>
        produce(task, (draft) => {
          draft.trajMetrics.push(castDraft(metric));
        }),
      ),
    );

export const satisfies = <G extends Grade.Result, E extends Schema.JsonObject = EmptyRecord>() =>
  Effect.satisfiesSuccessType<Task<G, E>>();

const task = Effect.gen(function* () {
  return yield* make({
    name: "Task",
    snapshot: yield* Snapshot.fromContainerfile({ filePath: "Dockerfile" }),
    metrics: [
      {
        id: "task-metric-from-options",
        exec: async () => ({ score: 1 }),
      },
    ],
    trajMetrics: [
      {
        id: "traj-metric-from-options",
        exec: async () => ({ messageCount: 1 }),
      },
    ],
  }).pipe(
    stage("stage1", {
      prompt: Prompt.userMessage({ content: [Prompt.makePart("text", { text: "Hello, world!" })] }),
      grader: async () => ({ fuck: "you" }),
    }),
    stage("stage2", {
      prompt: Prompt.userMessage({ content: [Prompt.makePart("text", { text: "Hello, world!" })] }),
      grader: async ({ results: { stage1 } }) => ({ score: 1 }),
    }),
    metric("task-metric-from-pipe", {
      exec: async () => ({ score: 1 }),
    }),
    trajMetric("traj-metric-from-pipe", {
      exec: async () => ({ messageCount: 1 }),
    }),
    satisfies<{ score: number }>(),
  );
});

void task;

export const metadata = (task: Task): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: task.extras,
  });
