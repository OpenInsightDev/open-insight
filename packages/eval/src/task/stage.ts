import type { Sandbox } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { IDSchema } from "#/utils/schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import type { PromptFn } from "./prompt.ts";
import type { Builder } from "./build.ts";
import { castDraft, produce } from "immer";

export class StageMetadata extends Schema.Class<StageMetadata>("StageMetadata")({
  id: IDSchema,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type StageMetadataEncoded = Schema.Codec.Encoded<typeof StageMetadata>;

export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;

export type Stage<
  /** Grade result of this stage */
  G extends Grade.Result = Grade.Result,
  /** Previous stage results */
  Gs extends Grade.Result = never,
> = Readonly<{
  metadata: StageMetadata;
  prompt: PromptFn;
  grader: Grade.Grader<G, Gs>;
  init: Init | null;
  resume: boolean;
}>;

type Options<G extends Grade.Result, Gs extends Grade.Result> = Readonly<{
  prompt: PromptFn;
  grader: Grade.Grader<G, Gs>;
  init?: Init | null;
  resume?: boolean;
}> &
  Omit<StageMetadataEncoded, "name">;

export const stage =
  <G extends Grade.Result>(schema: G) =>
  <N extends string, Gs extends Grade.Result>(name: N, options: Options<G, Gs>) =>
  <BG extends Grade.Result, BE extends Schema.Constraint, E, R>(
    builder: Effect.Effect<Builder<BG, BE, Gs>, E, R>,
  ) =>
    builder.pipe(
      Effect.flatMap(
        Effect.fn(function* (builder) {
          const { resume = true, init = null, prompt, grader } = options;

          const metadata = yield* Schema.decodeEffect(StageMetadata)({ ...options, name });

          const stage = {
            metadata,
            prompt,
            grader,
            resume,
            init,
          } satisfies Stage<G, Gs>;

          return produce(builder, (draft) => {
            draft.stages.push(castDraft(stage));
          });
        }),
      ),
    );
