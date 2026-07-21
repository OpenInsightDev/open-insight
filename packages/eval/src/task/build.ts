import { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
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

type Stage = Readonly<{
  prompt: PromptStream;
  grader: Grade.Grader;
}>;

type StageOptions = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Grader;
}>;

export type Task<G extends Grade.Result = Grade.Result> = Readonly<{
  stages: ReadonlyArray<Stage>;
}> & { _G?: G };

type Builder<G extends Grade.Result = never> = Readonly<{}>;

export const init = <G extends Grade.Result = Grade.Result>(
  options: Schema.Codec.Encoded<Metadata> &
    Readonly<{
      snpashot: Snapshot.Snapshot;
      resources?: Sandbox.Resources;
    }>,
) => {};

export const stage = (options: StageOptions) => (builder: Builder) => {};
