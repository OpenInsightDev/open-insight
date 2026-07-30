import type { Sandbox } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { IDSchema } from "#/utils/schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Crypto, Effect, Schema } from "effect";
import { BuilderTypeId, TypeId, type Builder, type Task } from "./build.ts";
import { Error } from "./error.ts";
import type { PromptOptions } from "./prompt.ts";
import type * as Template from "./template.ts";

export class StageMetadata extends Schema.Class<StageMetadata>("StageMetadata")({
  id: IDSchema,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type StageMetadataEncoded = Schema.Codec.Encoded<typeof StageMetadata>;

/** Runs once at the start of the stage, before verifier checks or agent interaction. */
export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;

/** A stage and the result record produced by all stages that precede it. */
export type Stage<
  /** Grade result. */
  G extends Grade.Result = Grade.Result,
  /** Previous stage results. */
  S extends Grade.Results = Grade.Results,
> = Readonly<{
  metadata: StageMetadata;
  prompt: PromptOptions;
  grader: Grade.Grader<G, S>;
  init: Init | null;
  resume: boolean;
}>;

export type StageBase = Stage;

type AppendResult<S extends Grade.Results, N extends string, G extends Grade.Result> = [S] extends [
  never,
]
  ? Readonly<{ [K in N]: G }>
  : S & Readonly<{ [K in N]: G }>;

type StageOptionsBase<R extends Schema.JsonObject, S extends Grade.Results> = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Definition<R, S>;
  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name">;

export type StageOptions<
  /** Grade schema. */
  GS extends Grade.ResultSchema = Grade.ResultSchema,
  /** Previous stage results. */
  S extends Grade.Results = never,
> = StageOptionsBase<GS["Encoded"], S>;

export type EndStageOptions<
  T extends Template.Unknown = Template.Unknown,
  S extends Grade.Results = never,
> = StageOptionsBase<Template.GradeResultEncoded<T>, S>;

const makeStage = Effect.fn(function* <GS extends Grade.ResultSchema, S extends Grade.Results>(
  schema: GS,
  name: string,
  options: StageOptions<GS, S>,
): Effect.fn.Return<Stage<GS["Type"], S>, Error, Crypto.Crypto> {
  const { resume = true, init = null, prompt } = options;
  const metadata = yield* Schema.decodeEffect(StageMetadata)({ ...options, name }).pipe(
    Effect.mapError(Error.metadata),
  );
  const grader: Grade.Grader<GS["Type"], S> = { ...options.grader, schema };
  return { metadata, prompt, grader, resume, init };
});

/** Adds an intermediate stage and infers all preceding stage results from the pipe input. */
export const stage =
  <GS extends Grade.ResultSchema>(schema: GS) =>
  <N extends string, S extends Grade.Results>(name: N, options: StageOptions<GS, NoInfer<S>>) =>
  <Current extends Grade.Result, X extends object, T extends Template.Unknown, E, R>(
    task: Effect.Effect<Builder<Current, X, S, T>, E, R>,
  ): Effect.Effect<
    Builder<GS["Type"], X, AppendResult<S, N, GS["Type"]>, T>,
    E | Error,
    R | Crypto.Crypto
  > =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const next = yield* makeStage(schema, name, options);
          return {
            ...task,
            stages: [...task.stages, next],
            [BuilderTypeId]: (value) => value,
          } satisfies Builder<GS["Type"], X, AppendResult<S, N, GS["Type"]>, T>;
        }),
      ),
    );

/** Adds the final stage using the task template's grade schema and completes the task. */
export const endStage =
  <T extends Template.Unknown, S extends Grade.Results>(
    name: string,
    options: EndStageOptions<T, NoInfer<S>>,
  ) =>
  <G extends Grade.Result, X extends object, E, R>(
    task: Effect.Effect<Builder<G, X, S, T>, E, R>,
  ): Effect.Effect<Task<Template.GradeResult<T>, X, T>, E | Error, R | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const next = yield* makeStage(task.template.Grade, name, options);
          return {
            ...task,
            stages: [...task.stages, next],
            [TypeId]: TypeId,
          } satisfies Task<Template.GradeResult<T>, X, T>;
        }),
      ),
    );
