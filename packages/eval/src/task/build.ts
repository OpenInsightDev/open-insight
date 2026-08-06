import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { Harness, Sandbox, type Snapshot } from "@open-insight/core/internal";
import { IDSchema } from "#/utils/schema.ts";
import type { BivariantFn, UnionToIntersection } from "#/utils/variant.ts";
import { makePromptFn, type PromptFn, type PromptOptions } from "./prompt.ts";
import { castDraft, produce } from "immer";
import type { SchemaError } from "effect/SchemaError";
import { TaskError } from "./error.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export class BaseMetadata extends Schema.Class<BaseMetadata>("BaseMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class StageMetadata extends Schema.Class<StageMetadata>("StageMetadata")({
  id: IDSchema,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type StageMetadataEncoded = Schema.Codec.Encoded<typeof StageMetadata>;

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  base: BaseMetadata,
  stages: Schema.Array(StageMetadata),
  extras: Schema.Record(Schema.String, Schema.Json),
}) {}

export type Task<G extends Grade.Result = never, S extends Stage = never> = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;

  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  stages: ReadonlyArray<Stage>;

  sandboxConfig: Harness.SandboxSessionConfig;

  [TypeId]: TypeId;
}> & { _G?: G; _S?: S };

export type AnyTask = Task<any, any>;

const InitialStageName = "initial";
type InitialStageName = typeof InitialStageName;

type Options<G extends Grade.Result> = BaseMetadataEncoded &
  Partial<Harness.SandboxSessionConfig> &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
  }> &
  StageOptions<G, never>;

export const make = Effect.fn(function* <G extends Grade.Result>(
  options: Options<G>,
): Effect.fn.Return<Task<G, Stage<InitialStageName, G>>, TaskError> {
  const { snapshot, trajMetrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe(
    Effect.mapError(TaskError.metadata),
  );

  const initialStage = yield* makeStage<InitialStageName, G, never>("initial", options).pipe(
    Effect.mapError(TaskError.metadata),
  );

  return {
    metadata,
    snapshot,
    trajMetrics,
    metrics: [],
    stages: [initialStage],
    [TypeId]: TypeId,
    sandboxConfig: {
      ...Harness.DefaultSandboxSessionConfig,
      ...options,
    },
  } satisfies Task<G, Stage<InitialStageName, G>>;
});

export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;

export type Stage<
  N extends string = string,
  G extends Grade.Result = Grade.Result,
  S extends Stage = never,
> = Readonly<{
  name: N;
  metadata: StageMetadata;
  prompt: PromptFn;
  makePrompt: () => PromptFn;
  grader: Grade.Grader<G, StageResults<S>>;
  init: Init | null;
  resume: boolean;
}>;
type StageResult<S> = S extends Stage<infer N, infer G, infer _> ? Record<N, G["Type"]> : never;
type StageResults<S extends Stage> = UnionToIntersection<StageResult<S>>;

type StageOptions<G extends Grade.Result, S extends Stage> = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResults<S>>;
  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name">;

const makeStage = Effect.fn(function* <N extends string, G extends Grade.Result, S extends Stage>(
  name: N,
  options: StageOptions<G, S>,
): Effect.fn.Return<Stage<N, G, S>, SchemaError> {
  const { prompt: promptOptions, grader, init = null, resume = false } = options;
  const metadata = yield* Schema.decodeEffect(StageMetadata)({
    ...options,
    name,
  });

  const makePrompt = () => makePromptFn(promptOptions);

  return {
    name,
    metadata,
    prompt: makePrompt(),
    makePrompt,
    grader,
    init,
    resume,
  } satisfies Stage<N, G, S>;
});

export const stage =
  <N extends string, G extends Grade.Result, S extends Stage>(
    name: N,
    options: StageOptions<G, S>,
  ) =>
  <TG extends Grade.Result, E, R>(task: Effect.Effect<Task<TG, S>, E, R>) =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task): Effect.fn.Return<
          Task<G, S | Stage<N, G, S>>,
          E | SchemaError,
          R
        > {
          const nextStage = yield* makeStage(name, options);

          return produce(task, (draft) => {
            draft.stages.push(castDraft(nextStage));
          }) as Task<G, S | Stage<N, G, S>>;
        }),
      ),
    );

export const satisfies =
  <N extends string, G extends Grade.Result>() =>
  <S extends Stage, E, R>(task: Effect.Effect<Task<G, S | Stage<N, G, S>>, E, R>) =>
    task;

export type GradeOf<T> = T extends Task<infer G, infer _> ? G["Type"] : never;
