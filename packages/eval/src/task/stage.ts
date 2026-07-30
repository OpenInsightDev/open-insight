import type { Sandbox } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { IDSchema } from "#/utils/schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Crypto, Effect, Schema } from "effect";
import { BuilderTypeId, type Builder } from "./build.ts";
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
  /** Stage name. */
  N extends string = string,
  /** Grade result. */
  G extends Grade.Result = Grade.Result,
  /** Previous stage results. */
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

type StageSchema<F extends Schema.Struct.Fields> = Schema.Struct<F> &
  Grade.ResultSchema<Schema.Struct.Type<F>>;
type StageGrade<F extends Schema.Struct.Fields> = StageSchema<F>["Type"];
type StageGradeEncoded<F extends Schema.Struct.Fields> = StageSchema<F>["Encoded"];

type Verification<F extends Schema.Struct.Fields> =
  | Readonly<{
      verif?: never;
      expect?: never;
    }>
  | Grade.VerifOptions<StageGradeEncoded<F>>;

function makeStructResult<const F extends Schema.Struct.Fields>(fields: F): StageSchema<F>;
function makeStructResult(fields: Schema.Struct.Fields) {
  return Schema.Struct(fields);
}

type StageOptionsBase<
  N extends string,
  F extends Schema.Struct.Fields,
  S extends Grade.Results,
> = Readonly<{
  name: N;
  prompt: PromptOptions;
  grader: Grade.Exec<StageGradeEncoded<F>, StageResults<S>>;
  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name"> &
  Verification<F>;

/** Options for defining a new stage schema inline via struct fields. */
export type StageOptions<
  /** Stage name. */
  N extends string = string,
  /** Grade schema fields. */
  F extends Schema.Struct.Fields = Schema.Struct.Fields,
  /** Previous stage results. */
  S extends Grade.Results = never,
> = StageOptionsBase<N, F, S> &
  Readonly<{
    schema: F;
  }>;

/** Adds a stage from struct fields and infers all preceding stage results from the pipe input. */
export const stage =
  <N extends string, F extends Schema.Struct.Fields, S extends Grade.Results>(
    name: N,
    options: Omit<StageOptions<N, F, NoInfer<S>>, "name">,
  ) =>
  <G extends Grade.Result, X extends object, T extends Template.Unknown, E, R>(
    task: Effect.Effect<Builder<G, X, S, T>, E, R>,
  ): Effect.Effect<
    Builder<StageGrade<F>, X, AppendResult<S, N, StageGrade<F>>, T>,
    E | Error,
    R | Crypto.Crypto
  > =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const { resume = true, init = null, prompt } = options;
          const metadata = yield* Schema.decodeEffect(StageMetadata)({ ...options, name }).pipe(
            Effect.mapError(Error.metadata),
          );
          const schema = makeStructResult(options.schema);
          const grader: Grade.Grader<StageGrade<F>, StageResults<S>> = options.verif === undefined
            ? { schema, grade: options.grader }
            : {
                schema,
                grade: options.grader,
                verif: options.verif,
                expect: options.expect,
              };
          const next: Stage<N, StageGrade<F>, S> = {
            metadata,
            prompt,
            grader,
            resume,
            init,
          };
          return {
            ...task,
            stages: [...task.stages, next],
            [BuilderTypeId]: (value) => value,
          } satisfies Builder<StageGrade<F>, X, AppendResult<S, N, StageGrade<F>>, T>;
        }),
      ),
    );
