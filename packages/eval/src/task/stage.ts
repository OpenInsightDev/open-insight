import type { Sandbox } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { IDSchema } from "#/utils/schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Crypto, Effect, Schema } from "effect";
import type { Builder } from "./build.ts";
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

export type StageBase = Readonly<{
  metadata: StageMetadata;
  prompt: PromptOptions;
  grader: Grade.Grader<Grade.Result, Grade.Results>;
  init: Init | null;
  resume: boolean;
}>;

/** A stage and the result record produced by all stages that precede it. */
export type Stage<
  N extends string = string,
  G extends Grade.Result = Grade.Result,
  S extends Grade.Results = never,
> = Readonly<{
  metadata: StageMetadata;
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResults<S>>;
  init: Init | null;
  resume: boolean;
}> & { _N?: N; _G?: G; _S?: S };

export type StageResults<S extends Grade.Results> = [S] extends [never] ? never : S;

type AppendResult<S extends Grade.Results, N extends string, G extends Grade.Result> = [S] extends [
  never,
]
  ? Readonly<{ [K in N]: G }>
  : S & Readonly<{ [K in N]: G }>;

type Verification<R extends Schema.JsonObject> =
  | Readonly<{
      verif?: never;
      expect?: never;
    }>
  | Grade.VerifOptions<R>;

type StructResultSchema<F extends Schema.Struct.Fields> = Schema.Struct<F> &
  Grade.ResultSchema<Schema.Struct.Type<F>>;

function makeStructResult<const F extends Schema.Struct.Fields>(fields: F): StructResultSchema<F>;
function makeStructResult(fields: Schema.Struct.Fields) {
  return Schema.Struct(fields);
}

type StageOptionsBase<
  N extends string,
  R extends Schema.JsonObject,
  S extends Grade.Results,
> = Readonly<{
  name: N;
  prompt: PromptOptions;
  grader: Grade.Exec<R, StageResults<S>>;
  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name"> &
  Verification<R>;

export type StageOptions<
  N extends string = string,
  F extends Schema.Struct.Fields = Schema.Struct.Fields,
  S extends Grade.Results = never,
> = StageOptionsBase<N, StructResultSchema<F>["Encoded"], S> &
  Readonly<{
    schema: F;
  }>;

export type StageFromOptions<
  N extends string = string,
  GS extends Grade.ResultSchema = Grade.ResultSchema,
  S extends Grade.Results = never,
> = StageOptionsBase<N, GS["Encoded"], S> &
  Readonly<{
    schema: GS;
  }>;

const makeGrader = <N extends string, GS extends Grade.ResultSchema, S extends Grade.Results>(
  options: Omit<StageFromOptions<N, GS, S>, "name">,
): Grade.Grader<GS["Type"], StageResults<S>> =>
  options.verif === undefined
    ? { schema: options.schema, grade: options.grader }
    : {
        schema: options.schema,
        grade: options.grader,
        verif: options.verif,
        expect: options.expect,
      };

type MakeStageFrom = <N extends string, GS extends Grade.ResultSchema, S extends Grade.Results>(
  name: N,
  options: Omit<StageFromOptions<N, GS, S>, "name">,
) => Effect.Effect<Stage<N, GS["Type"], S>, Error, Crypto.Crypto>;

const makeStageFrom: MakeStageFrom = Effect.fn(function* (name, options) {
  const { resume = true, init = null, prompt } = options;
  const metadata = yield* Schema.decodeEffect(StageMetadata)({ ...options, name }).pipe(
    Effect.mapError(Error.metadata),
  );
  return {
    metadata,
    prompt,
    grader: makeGrader(options),
    resume,
    init,
  };
});

type MakeStageFields = <N extends string, F extends Schema.Struct.Fields, S extends Grade.Results>(
  name: N,
  options: Omit<StageOptions<N, F, S>, "name">,
) => Effect.Effect<Stage<N, StructResultSchema<F>["Type"], S>, Error, Crypto.Crypto>;

const makeStageFields: MakeStageFields = Effect.fn(function* <
  N extends string,
  F extends Schema.Struct.Fields,
  S extends Grade.Results,
>(name: N, options: Omit<StageOptions<N, F, S>, "name">) {
  return yield* makeStageFrom<N, StructResultSchema<F>, S>(name, {
    ...options,
    schema: makeStructResult(options.schema),
  });
});

export const makeStage = Object.assign(makeStageFields, { from: makeStageFrom });

/** Adds a stage from a complete result schema. */
const stageFrom =
  <N extends string, GS extends Grade.ResultSchema, S extends Grade.Results>(
    name: N,
    options: Omit<StageFromOptions<N, GS, NoInfer<S>>, "name">,
  ) =>
  <CurrentG extends Grade.Result, Ex extends object, T extends Template.Any, E, R>(
    task: Effect.Effect<Builder<CurrentG, Ex, S, T>, E, R>,
  ): Effect.Effect<
    Builder<GS["Type"], Ex, AppendResult<S, N, GS["Type"]>, T>,
    E | Error,
    R | Crypto.Crypto
  > =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const next = yield* makeStageFrom(name, options);
          return {
            ...task,
            stages: [...task.stages, next],
          } satisfies Builder<GS["Type"], Ex, AppendResult<S, N, GS["Type"]>, T>;
        }),
      ),
    );

const stageFields =
  <N extends string, F extends Schema.Struct.Fields, S extends Grade.Results>(
    name: N,
    options: Omit<StageOptions<N, F, NoInfer<S>>, "name">,
  ) =>
  <CurrentG extends Grade.Result, Ex extends object, T extends Template.Any, E, R>(
    task: Effect.Effect<Builder<CurrentG, Ex, S, T>, E, R>,
  ): Effect.Effect<
    Builder<
      StructResultSchema<F>["Type"],
      Ex,
      AppendResult<S, N, StructResultSchema<F>["Type"]>,
      T
    >,
    E | Error,
    R | Crypto.Crypto
  > =>
    stageFrom<N, StructResultSchema<F>, S>(name, {
      ...options,
      schema: makeStructResult(options.schema),
    })(task);

/** Adds a stage from struct fields and infers all preceding stage results from the pipe input. */
export const stage = Object.assign(stageFields, { from: stageFrom });
