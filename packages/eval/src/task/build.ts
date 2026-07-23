import { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import { Effect, Schema, Stream } from "effect";
import { Error } from "./error.ts";
import * as Metric from "./metric.ts";
import { makeID } from "#/utils/id.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export type ID = string;

export class Metadata extends Schema.Class<Metadata>("TaskMetadata")({
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  extras: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
}) {}

type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

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
  id: string;
  name: string;
  description: string | null;

  prompt: PromptStream;
  grader: Grade.Grader<G>;
}>;

type StageOptions<G extends Grade.Result = Grade.Result> = Readonly<{
  name?: string;
  description?: string | null;
  prompt: PromptOptions;
  grader: Grade.Grader<G>;
}>;

const makeStage = Effect.fn(function* (
  order: number,
  { prompt, grader, description = null, name = `Stage ${order}` }: StageOptions,
) {
  return {
    id: yield* makeID(),
    name,
    description,
    prompt: makePromptStream(prompt),
    grader,
  };
});

export type Task<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = Readonly<{
  metadata: Metadata;
  snapshot: Snapshot.Snapshot;
  resources: Sandbox.Resources;

  /**
   * Execution stages of the task.
   * Stages are executed sequentially.
   * When executing a stage, the prompt(s) of the stage will be sent to the agent.
   * When all prompts are sent and the agent has finished responding, the grader of the stage will be executed.
   * If the stage grader returns a passing result, the next stage will be executed.
   * The grading result of the last stage will be used as the final result of the task.
   */
  stages: ReadonlyArray<Stage>;

  metrics: ReadonlyArray<Metric.Metric>;
  extras: E;
}> & { _G?: G } & AsyncDisposable;

type Options<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = MetadataEncoded &
  StageOptions<G> &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    metrics?: ReadonlyArray<Metric.Options>;
    resources?: Sandbox.Resources;
    stages?: ReadonlyArray<StageOptions>;
    extras?: E;
    [Symbol.asyncDispose]?: () => PromiseLike<void>;
  }>;

export const make = Effect.fn(function* <
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
>(options: Options<G, E>) {
  const {
    snapshot,
    resources = new Sandbox.Resources(),
    prompt,
    grader,
    stages: stageOptions = [],
    metrics = [],
    extras = {} as E,
    [Symbol.asyncDispose]: dispose,
  } = options;

  const metadata = Schema.decodeSync(Metadata)({
    ...options,
    extras,
  });

  const stages = yield* Effect.all(
    [...stageOptions, { prompt, grader }].map((stage, index) => makeStage(index + 1, stage)),
  );

  return {
    metadata,
    snapshot,
    resources,
    stages,
    metrics: metrics.map(Metric.make),
    extras,
    [Symbol.asyncDispose]: dispose,
  };
});
