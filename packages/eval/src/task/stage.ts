import * as Grade from "#/grade/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import { Error } from "./error.ts";
import { IDSchema } from "#/utils/id.ts";
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

export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;

export type Stage<
  N extends string = string,
  G extends Grade.Result = any,
  S extends Stage = any,
> = Readonly<{
  metadata: StageMetadata;
  prompt: PromptOptions;
  grader: Grade.Grader<G, StageResults<S>>;

  init: Init | null;
  resume: boolean;
}> & { _N?: N; _G?: G; _S?: S };

type StageResults<T> = T extends Stage<infer N, infer G, infer S> ? { [T in S as N]: G } : never;

export type StageOptions<
  N extends string = string,
  G extends Grade.Result = Grade.Result,
  S extends Stage = never,
> = Readonly<{
  name: N;
  prompt: PromptOptions;
  grader: Grade.InputGrader<G, StageResults<S>>;

  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name">;

export const makeStage = Effect.fn(function* (options: StageOptions) {
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
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const stage = yield* makeStage({ ...options, name });
          return produce(task, (draft) => {
            draft.stages.push(castDraft(stage));
          }) as Task<SG, Ex, S | Stage<N, SG, S>>;
        }),
      ),
    );
