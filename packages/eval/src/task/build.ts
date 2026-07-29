import { Resource, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema, Scope } from "effect";
import { Error } from "./error.ts";
import { StageMetadata } from "./stage.ts";
import type { StageBase } from "./stage.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export type JsonObjectSchema<T extends object = object> = Grade.ResultSchema<T>;

export const EmptyExtras = Schema.Record(Schema.String, Schema.Never);

export type TaskSchema<G extends Grade.Result, E extends object> = Readonly<{
  extras: JsonObjectSchema<E>;
  grade: JsonObjectSchema<G> | null;
}>;

export class BaseMetadata extends Schema.Class<BaseMetadata>("BaseMetadata")({
  id: Schema.String,
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

export type Task<
  G extends Grade.Result = Grade.Result,
  E extends object = object,
  S = unknown,
> = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;
  resources: Resource.Resources;

  /**
   * Execution stages of the task.
   *
   * Stages are executed sequentially.
   * When executing a stage, the prompt(s) of the stage will be sent to the agent.
   *
   * When all prompts are sent and the agent has finished responding, the grader of the stage will be executed.
   * If the stage grader returns a passing result, the next stage will be executed.
   */
  stages: ReadonlyArray<StageBase>;
  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  extras: E;
  schema: TaskSchema<G, E>;
}> & { _G?: G; _E?: E; _S?: S };

export type Array<
  G extends Grade.Result = Grade.Result,
  E extends object = EmptyRecord,
> = ReadonlyArray<Task<G, E>>;

type BaseOptions = BaseMetadataEncoded &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Resource.Resources;
  }>;

type NoExtrasOptions = BaseOptions &
  Readonly<{
    extras?: never;
  }>;

type ExtrasOptions<ES extends JsonObjectSchema> = BaseOptions &
  Readonly<{
    extras: Readonly<{
      /** The runtime codec for extras, stored with the task for serialization. */
      schema: ES;
      value: ES["Encoded"];
    }>;
  }>;

export type Options<
  E extends object = EmptyRecord,
  ES extends JsonObjectSchema<E> = JsonObjectSchema<E>,
> = [E] extends [EmptyRecord] ? NoExtrasOptions | ExtrasOptions<ES> : ExtrasOptions<ES>;

const decodeMetadata = (options: BaseOptions) =>
  Schema.decodeEffect(BaseMetadata)(options).pipe(Effect.mapError(Error.metadata));

const makeWithoutExtras = Effect.fn(function* (
  options: NoExtrasOptions,
): Effect.fn.Return<Task<never, EmptyRecord, never>, Error, Crypto.Crypto | Scope.Scope> {
  const { snapshot, resources = Resource.Resources.make({}) } = options;
  const metadata = yield* decodeMetadata(options);
  const extras = yield* Schema.decodeEffect(EmptyExtras)({}).pipe(Effect.mapError(Error.metadata));

  return {
    metadata,
    snapshot,
    resources,
    extras,
    stages: [],
    metrics: [],
    trajMetrics: [],
    schema: {
      extras: EmptyExtras,
      grade: null,
    },
  } satisfies Task<never, EmptyRecord, never>;
});

const makeWithExtras = Effect.fn(function* <ES extends JsonObjectSchema>(
  options: ExtrasOptions<ES>,
): Effect.fn.Return<Task<never, ES["Type"], never>, Error, Crypto.Crypto | Scope.Scope> {
  const { snapshot, resources = Resource.Resources.make({}), extras } = options;
  const metadata = yield* decodeMetadata(options);

  const decodedExtras = yield* Schema.decodeUnknownEffect(extras.schema)(extras.value).pipe(
    Effect.mapError(Error.metadata),
  );

  return {
    metadata,
    snapshot,
    resources,
    extras: decodedExtras,
    stages: [],
    metrics: [],
    trajMetrics: [],
    schema: {
      extras: extras.schema,
      grade: null,
    },
  } satisfies Task<never, ES["Type"], never>;
});

export function make(
  options: NoExtrasOptions,
): Effect.Effect<Task<never, EmptyRecord, never>, Error, Crypto.Crypto | Scope.Scope>;
export function make<ES extends JsonObjectSchema>(
  options: ExtrasOptions<ES>,
): Effect.Effect<Task<never, ES["Type"], never>, Error, Crypto.Crypto | Scope.Scope>;
export function make(options: NoExtrasOptions | ExtrasOptions<JsonObjectSchema>) {
  return options.extras === undefined ? makeWithoutExtras(options) : makeWithExtras(options);
}

export const metadata = (task: Task): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: Schema.encodeSync(task.schema.extras)(task.extras),
  });

export const metadataSchema = <G extends Grade.Result, E extends object, S>(task: Task<G, E, S>) =>
  Schema.Struct({
    base: BaseMetadata,
    stages: Schema.Array(StageMetadata),
    extras: Schema.toEncoded(task.schema.extras),
  });
