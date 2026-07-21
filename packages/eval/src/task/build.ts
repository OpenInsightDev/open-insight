import type * as Grade from "#/grade/index.ts";
import { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import { Array, Schema, Stream } from "effect";
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

type MetadataSchema = Schema.ConstraintDecoder<Metadata>;

export type Options<
  G extends Grade.Result = Grade.Result,
  M extends MetadataSchema = typeof Metadata,
> = Schema.Codec.Encoded<M> &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Sandbox.Resources;
    dispose?: () => Promise<void>;
  }> &
  (StageOptions<G> | { stages: [...StageOptions[], StageOptions<G>] });

export type Task<G extends Grade.Result = Grade.Result, M extends Metadata = Metadata> = Readonly<{
  [TypeId]: TypeId;
  metadata: Schema.JsonObject;
  snapshot: Snapshot.Snapshot;
  resources?: Sandbox.Resources;
  stages: ReadonlyArray<Stage>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> & { _G?: G; _M?: M };

const isMetadataSchema = <M extends MetadataSchema>(value: unknown): value is M =>
  Schema.isSchema(value);

function makeTask<G extends Grade.Result, M extends MetadataSchema>(
  metadataSchema: M,
  options: Options<G, M>,
): Task<G, M["Type"]>;
function makeTask<G extends Grade.Result, M extends MetadataSchema>(
  metadataSchema: M,
  options: Options<G, M>,
): unknown {
  const stageOptions = "stages" in options ? options.stages : [options];

  return {
    [TypeId]: TypeId,
    metadata: Schema.decodeSync(metadataSchema)(options),
    snapshot: options.snapshot,
    resources: options.resources,
    stages: Array.map(stageOptions, makeStage),
    [Symbol.asyncDispose]: options.dispose ?? (async () => {}),
  };
}

export function make<G extends Grade.Result = Grade.Result>(options: Options<G>): Task<G>;
export function make<M extends MetadataSchema>(
  metadataSchema: M,
): <G extends Grade.Result = Grade.Result>(options: Options<G, M>) => Task<G, M["Type"]>;
export function make<G extends Grade.Result, M extends MetadataSchema>(
  optionsOrSchema: Options<G> | M,
): unknown {
  return isMetadataSchema(optionsOrSchema)
    ? (options: Options<G, M>) => makeTask(optionsOrSchema, options)
    : makeTask(Metadata, optionsOrSchema);
}
