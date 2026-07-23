import { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import { Crypto, Effect, Schema, Scope } from "effect";
import { Error } from "./error.ts";
import * as Metric from "#/metric/index.ts";
import { IDSchema } from "#/utils/id.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export type ID = string;

export class StageMetadata extends Schema.Class<StageMetadata>("StageMetadata")({
  id: IDSchema,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type StageMetadataEncoded = Schema.Codec.Encoded<typeof StageMetadata>;

export class BaseMetadata extends Schema.Class<BaseMetadata>("BaseMetadata")({
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  base: BaseMetadata,
  stages: Schema.Array(StageMetadata),
  extras: Schema.Record(Schema.String, Schema.Json),
}) {}

export type PromptFnInput = {
  /**
   * Full trajectory of the agent's session.
   */
  trajectory: Prompt.Trajectory;
  /**
   * Newly generated messages since the last call.
   */
  generated: ReadonlyArray<Prompt.Message>;
};

export type PromptInit = Prompt.UserMessage | Prompt.Trajectory;
export type PromptOptions =
  // return Prompt.Trajectory immediately, then always return null
  | PromptInit
  // receive input (first input is empty) and return Prompt.UserMessage for subsequent calls
  | AsyncIterable<Prompt.UserMessage, void, PromptFnInput>
  // return `init` first, then receive inputs and return Prompt.UserMessage for subsequent calls
  | Readonly<{
      init: PromptInit;
      then: AsyncIterable<Prompt.UserMessage, void, PromptFnInput>;
    }>;

/**
 * Produces the next batch of user messages from the current agent session.
 *
 * Returning `null` completes the prompt. A trajectory lets static input
 * preserve its entire initial sequence; generator input produces a
 * single-message trajectory for each subsequent invocation.
 */
export type PromptFn = (input: PromptFnInput) => Effect.Effect<Prompt.Trajectory | null, Error>;

const toTrajectory = (input: PromptInit): Prompt.Trajectory =>
  Prompt.isMessage(input) ? Prompt.make([input]) : input;

const isAsyncIterable = (
  options: PromptOptions,
): options is AsyncIterable<Prompt.UserMessage, void, PromptFnInput> =>
  Symbol.asyncIterator in options;

export const makePrompt = Effect.fn(function* (options: PromptOptions) {
  if (!isAsyncIterable(options) && !("then" in options)) {
    let pending: Prompt.Trajectory | null = toTrajectory(options);
    return ((_: PromptFnInput) => {
      const next = pending;
      pending = null;
      return Effect.succeed(next);
    }) satisfies PromptFn;
  }

  const init = isAsyncIterable(options) ? undefined : options.init;
  const then = isAsyncIterable(options) ? options : options.then;

  const iterator = yield* Effect.try({
    try: () => then[Symbol.asyncIterator](),
    catch: Error.prompt,
  });
  let pending: Prompt.Trajectory | undefined = init === undefined ? undefined : toTrajectory(init);

  return ((input: PromptFnInput) => {
    if (pending !== undefined) {
      const next = pending;
      pending = undefined;
      return Effect.succeed(next);
    }

    return Effect.tryPromise({
      try: async () => {
        const next = await iterator.next(input);
        return next.done ? null : Prompt.make([next.value]);
      },
      catch: Error.prompt,
    });
  }) satisfies PromptFn;
});

type Stage<G extends Grade.Result = Grade.Result> = Readonly<{
  metadata: StageMetadata;
  prompt: PromptFn;
  grader: Grade.Grader<G>;
}>;

type StageOptions<G extends Grade.Result = Grade.Result> = Readonly<{
  prompt: PromptOptions;
  grader: Grade.Grader<G>;
}> &
  StageMetadataEncoded;

const makeStage = Effect.fn(function* (options: StageOptions) {
  const { prompt, grader } = options;
  const metadata = yield* Schema.decodeEffect(StageMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  return {
    metadata,
    prompt: yield* makePrompt(prompt),
    grader,
  } satisfies Stage;
});

export type Task<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;
  resources: Sandbox.Resources;

  /**
   * Execution stages of the task.
   *
   * Stages are executed sequentially.
   * When executing a stage, the prompt(s) of the stage will be sent to the agent.
   *
   * When all prompts are sent and the agent has finished responding, the grader of the stage will be executed.
   * If the stage grader returns a passing result, the next stage will be executed.
   */
  stages: ReadonlyArray<Stage>;
  prompt: PromptFn;
  grader: Grade.Grader<G>;

  metrics: ReadonlyArray<Metric.Metric>;
  extras: E;
}> & { _G?: G };

export type Array<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = ReadonlyArray<Task<G, E>>;

type Options<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = BaseMetadataEncoded &
  StageOptions<G> &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    metrics?: ReadonlyArray<Metric.Options>;
    resources?: Sandbox.Resources;
    stages?: ReadonlyArray<StageOptions>;
    prompt: PromptOptions;
    grader: Grade.Grader<G>;
    extras?: E;
    [Symbol.asyncDispose]?: () => PromiseLike<void>;
  }>;

export const make = Effect.fn(function* <
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
>(options: Options<G, E>): Effect.fn.Return<Task<G, E>, Error, Crypto.Crypto | Scope.Scope> {
  const {
    snapshot,
    resources = new Sandbox.Resources(),
    prompt: promptOptions,
    grader,
    stages: stageOptions = [],
    metrics: metricOptions = [],
    extras = {} as E,
    [Symbol.asyncDispose]: dispose,
  } = options;

  const stages = yield* Effect.all(stageOptions.map(makeStage));
  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  const prompt = yield* makePrompt(promptOptions);
  const metrics = metricOptions.map(Metric.make);

  yield* Effect.addFinalizer(() =>
    Effect.tryPromise(async () => {
      await dispose?.();
    }),
  );

  return {
    metadata,
    snapshot,
    resources,
    stages,
    metrics,
    prompt,
    grader,
    extras,
  } satisfies Task<G, E>;
});

export const metadata = (task: Task): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: task.extras,
  });
