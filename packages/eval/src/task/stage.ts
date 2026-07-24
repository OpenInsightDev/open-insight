import * as Grade from "#/grade/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import { Error } from "./error.ts";
import { IDSchema } from "#/utils/id.ts";
import type { Task } from "./build.ts";
import type { PromptOptions } from "./prompt.ts";

export class StageMetadata extends Schema.Class<StageMetadata>("StageMetadata")({
  id: IDSchema,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type StageMetadataEncoded = Schema.Codec.Encoded<typeof StageMetadata>;

export type Stage<
  N extends string = string,
  G extends Grade.Result = any,
  S extends Stage = any,
> = Readonly<{
  metadata: StageMetadata;
  continue?: boolean;
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResult<S>>;
}> & { _N?: N; _G?: G; _S?: S };

type StageResult<T> = T extends Stage<infer N, infer G, infer S> ? { [T in S as N]: G } : never;

export type StageOptions<
  N extends string = string,
  G extends Grade.Result = Grade.Result,
  S extends Stage = never,
> = Readonly<{
  name: N;
  continue?: boolean;
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResult<S>>;
}> &
  Omit<StageMetadataEncoded, "name">;

export const makeStage = Effect.fn(function* (options: StageOptions) {
  const { continue: shouldContinue = true, prompt, grader } = options;
  const metadata = yield* Schema.decodeEffect(StageMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  return {
    metadata,
    continue: shouldContinue,
    prompt,
    grader,
  } satisfies Stage;
});

export const stage =
  <N extends string, SG extends Grade.Result, S extends Stage>(
    name: N,
    options: Omit<StageOptions<N, SG, S>, "name">,
  ) =>
  <G extends Grade.Result, Ex extends Schema.JsonObject, E, R>(
    task: Effect.Effect<Task<G, Ex, S>, E, R>,
  ): Effect.Effect<Task<SG, Ex, S | Stage<N, SG, S>>, E | Error, R | Crypto.Crypto> =>
    Effect.all([task, makeStage({ ...options, name })]).pipe(
      Effect.map(
        ([task, stage]) =>
          produce(task, (draft) => {
            draft.stages.push(castDraft(stage));
          }) as Task<SG, Ex, S | Stage<N, SG, S>>,
      ),
    );
