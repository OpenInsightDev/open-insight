import { Resource, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema, Scope } from "effect";
import { Error } from "./error.ts";
import { StageMetadata } from "./stage.ts";
import type { Stage } from "./stage.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

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
  E extends Schema.JsonObject = Schema.JsonObject,
  S extends Stage = any,
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
  stages: ReadonlyArray<Stage>;
  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  extras: E;
}> & { _G?: G; _E?: E; _S?: S };

export type Array<
  G extends Grade.Result = Grade.Result,
  E extends Schema.JsonObject = EmptyRecord,
> = ReadonlyArray<Task<G, E>>;

export type Options<E extends Schema.JsonObject = EmptyRecord> = BaseMetadataEncoded &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Resource.Resources;
    extras?: E;
  }>;

export const make = Effect.fn(function* <E extends Schema.JsonObject = EmptyRecord>(
  options: Options<E>,
): Effect.fn.Return<Task<never, E, never>, Error, Crypto.Crypto | Scope.Scope> {
  const { snapshot, resources = Resource.Resources.make({}), extras = {} as E } = options;

  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );

  return {
    metadata,
    snapshot,
    resources,
    extras,
    stages: [],
    metrics: [],
    trajMetrics: [],
  } satisfies Task<never, E, never>;
});

export const satisfies = <G extends Grade.Result, E extends Schema.JsonObject = EmptyRecord>() =>
  Effect.satisfiesSuccessType<Task<G, E>>();

export const metadata = (task: Task): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: task.extras,
  });
