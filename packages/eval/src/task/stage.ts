import * as Grade from "#/grade/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { Error } from "./error.ts";
import { IDSchema } from "#/utils/schema.ts";
import type { Task } from "./build.ts";
import type { PromptOptions } from "./prompt.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import type { Sandbox } from "@open-insight/core/internal";

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

export type Stage<
  N extends string = string,
  G extends Grade.Result = Grade.Result,
  S = never,
> = Readonly<{
  metadata: StageMetadata;
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResults<S>>;

  init: Init | null;
  resume: boolean;
}> & { _N?: N; _G?: G; _S?: S };

type StageResults<T> = [T] extends [never]
  ? never
  : T extends Stage<infer N, infer G, infer S>
    ? [S] extends [never]
      ? Readonly<{ [K in N]: G }>
      : StageResults<S> & Readonly<{ [K in N]: G }>
    : never;

export type StageOptions<
  N extends string = string,
  G extends Grade.Result = Grade.Result,
  S = never,
> = Readonly<{
  name: N;
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResults<S>>;

  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name">;

export const makeStage = Effect.fn(function* <N extends string, G extends Grade.Result, S>(
  options: StageOptions<N, G, S>,
): Effect.fn.Return<Stage<N, G, S>, Error, Crypto.Crypto> {
  const { resume = true, init = null, prompt, grader } = options;
  const metadata = yield* Schema.decodeEffect(StageMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  return {
    metadata,
    prompt,
    grader,
    resume,
    init,
  } satisfies Stage<N, G, S>;
});

export const stage =
  <N extends string, G extends Grade.Result, S>(
    name: N,
    options: Omit<StageOptions<N, G, S>, "name">,
  ) =>
  <CurrentG extends Grade.Result, Ex extends object, E, R>(
    task: Effect.Effect<Task<CurrentG, Ex, S>, E, R>,
  ): Effect.Effect<Task<G, Ex, Stage<N, G, S>>, E | Error, R | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const stage = yield* makeStage({ ...options, name });
          return {
            metadata: task.metadata,
            snapshot: task.snapshot,
            resources: task.resources,
            stages: [...task.stages, stage],
            metrics: task.metrics,
            trajMetrics: task.trajMetrics,
            extras: task.extras,
            schema: {
              extras: task.schema.extras,
              grade: stage.grader.schema,
            },
          } satisfies Task<G, Ex, Stage<N, G, S>>;
        }),
      ),
    );
