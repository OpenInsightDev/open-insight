import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { Resource, Sandbox, type Snapshot } from "@open-insight/core/internal";
import { IDSchema } from "#/utils/schema.ts";
import type { BivariantFn, Invariant, UnionToIntersection } from "#/utils/variant.ts";
import { makePromptFn, type PromptFn, type PromptOptions } from "./prompt.ts";
import { castDraft, produce } from "immer";
import type { SchemaError } from "effect/SchemaError";

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

export type AnyTask = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;
  resources: Resource.Resources;

  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  stages: ReadonlyArray<Stage>;

  [TypeId]: TypeId;
}>;

export type Task<G extends Grade.Result = never, S extends Stage = never> = AnyTask & {
  _G?: Invariant<G["Type"]>;
  _S?: Invariant<S>;
};

export const make = Effect.fn(function* (
  id: string,
  snapshot: Snapshot.Snapshot,
  options: Omit<BaseMetadataEncoded, "id"> &
    Readonly<{
      resources?: Resource.Resources;
      trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
    }>,
) {
  const { resources = Resource.make({}), trajMetrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)({ id, ...options });

  return {
    metadata,
    snapshot,
    resources,
    trajMetrics,
    metrics: [],
    stages: [],
    [TypeId]: TypeId,
  } as Task<never, never>;
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
  grader: Grade.Grader<G, StageResults<S>>;
  init: Init | null;
  resume: boolean;
}>;
type StageResult<S> = S extends Stage<infer N, infer G, infer _> ? Record<N, G["Type"]> : never;
type StageResults<S extends Stage> = UnionToIntersection<StageResult<S>>;

type Options<G extends Grade.Result, S extends Stage> = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResults<S>>;
  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name">;

export const stage =
  <N extends string, G extends Grade.Result, S extends Stage>(name: N, options: Options<G, S>) =>
  <PrevG extends Grade.Result, E, R>(task: Effect.Effect<Task<PrevG, S>, E, R>) =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task): Effect.fn.Return<
          Task<G, S | Stage<N, G, S>>,
          E | SchemaError,
          R
        > {
          const { prompt: promptOptions, grader, init = null, resume = false } = options;
          const metadata = yield* Schema.decodeEffect(StageMetadata)({
            ...options,
            name,
          });

          const prompt = makePromptFn(promptOptions);

          const stage = {
            name,
            metadata,
            prompt,
            grader,
            init,
            resume,
          } satisfies Stage<N, G, S>;

          return produce(task, (draft) => {
            draft.stages.push(castDraft(stage));
          }) as Task<G, S | Stage<N, G, S>>;
        }),
      ),
    );

export const satisfies =
  <N extends string, G extends Grade.Result>() =>
  <S extends Stage, E, R>(task: Effect.Effect<Task<G, S | Stage<N, G, S>>, E, R>) =>
    task;

export type GradeOf<T> = T extends Task<infer G, infer _> ? G["Type"] : never;
