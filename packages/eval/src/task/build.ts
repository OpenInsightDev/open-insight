import type * as Grade from "#/grade/index.ts";
import { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import { Schema, Stream } from "effect";
import { Error } from "./error.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export type ID = string;

export class Metadata extends Schema.Class<Metadata>("TaskMetadata")({
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  extra: Schema.OptionFromOptionalNullOr(Schema.Record(Schema.String, Schema.Json)),
}) {}

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

type StageOptions<G extends Grade.Result = Grade.Result> = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Grader<G>;
}>;
type Stage<G extends Grade.Result = Grade.Result> = Readonly<{
  prompt: PromptStream;
  grader: Grade.Grader<G>;
}>;

const makeStage = <G extends Grade.Result = Grade.Result>(options: StageOptions<G>): Stage<G> => ({
  prompt: makePromptStream(options.prompt),
  grader: options.grader,
});

export type Options<
  G extends Grade.Result = Grade.Result,
  M extends Metadata = Metadata,
> = Schema.Codec.Encoded<M> &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Sandbox.Resources;
  }> &
  (StageOptions<G> | { stages: [...StageOptions[], StageOptions<G>] });

export type Task<G extends Grade.Result = Grade.Result, M extends Metadata = Metadata> = Readonly<{
  metadata: M;
  snapshot: Snapshot.Snapshot;
  resources?: Sandbox.Resources;
  stages: readonly [...Stage[], Stage<G>];
}>;
