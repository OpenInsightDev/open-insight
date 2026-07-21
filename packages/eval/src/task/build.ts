import { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Schema, Stream } from "effect";
import { Error } from "./error.ts";
import type { ConstraintDecoder } from "effect/Schema";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export type ID = string;

export class Metadata extends Schema.Class<Metadata>("TaskMetadata")({
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}
type MetadataDecoder = Schema.ConstraintDecoder<Metadata>;

type PromptOptions = Prompt.UserMessage | Prompt.Trajectory | AsyncIterable<Prompt.UserMessage>;
type PromptStream = Stream.Stream<Prompt.Message, Error>;

const makePromptStream = (prompt: PromptOptions): PromptStream => {
  if (Prompt.isMessage(prompt)) {
    return Stream.make(prompt);
  }
  if ("content" in prompt) {
    return Stream.fromIterable(prompt.content);
  }
  return Stream.fromAsyncIterable(prompt, Error.prompt);
};

type Stage<G extends Grade.Result = Grade.Result> = Readonly<{
  prompt: PromptStream;
  grader: Grade.Grader<G>;
}>;

type StageOptions<G extends Grade.Result = Grade.Result> = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Grader<G>;
}>;

const makeStage = (options: StageOptions): Stage => {
  const { prompt, grader } = options;
  return {
    prompt: makePromptStream(prompt),
    grader,
  };
};

export type Task<G extends Grade.Result = Grade.Result, M extends Metadata = Metadata> = Readonly<{
  metadata: M;
  snapshot: Snapshot.Snapshot;
  resources: Sandbox.Resources;
  stages: ReadonlyArray<Stage>;
}> & { _G?: G } & AsyncDisposable;

type Options<
  G extends Grade.Result = Grade.Result,
  M extends ConstraintDecoder<Metadata> = MetadataDecoder,
> = M["Encoded"] &
  StageOptions<G> &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Sandbox.Resources;
    stages?: ReadonlyArray<StageOptions>;
    dispose?: () => PromiseLike<void>;
  }>;

export const makeWith =
  <M extends Metadata = Metadata>(decoder: Schema.ConstraintDecoder<M>) =>
  <G extends Grade.Result = Grade.Result>(options: Options<G, typeof decoder>) => {
    const {
      snapshot,
      resources = new Sandbox.Resources(),
      prompt,
      grader,
      stages = [],
      dispose,
    } = options;

    const metadata = Schema.decodeSync(decoder, { onExcessProperty: "ignore" })(options);

    return {
      metadata,
      snapshot,
      resources,
      stages: [...stages.map(makeStage), makeStage({ prompt, grader })],
      async [Symbol.asyncDispose]() {
        await dispose?.();
      },
    };
  };

export const make = <G extends Grade.Result = Grade.Result>(options: Options<G>): Task<G> => {
  return makeWith(Metadata)(options);
};
