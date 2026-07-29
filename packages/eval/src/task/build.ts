import { Resource, Snapshot } from "@open-insight/core/internal";
import { type EmptyRecord } from "#/utils/type.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema, Scope, Types } from "effect";
import { Error } from "./error.ts";
import { StageMetadata } from "./stage.ts";
import type { StageBase } from "./stage.ts";
import * as Template from "./template.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export type { JsonObjectSchema } from "./template.ts";

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
  S extends Grade.Results = Grade.Results,
  T extends Template.Any = Template.Template<Grade.ResultSchema<G>, Template.JsonObjectSchema<E>>,
> = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;
  resources: Resource.Resources;
  template: T;

  /** Execution stages, in their execution order. */
  stages: ReadonlyArray<StageBase>;
  /** Task-local metrics. Metric schemas are intentionally not part of a template yet. */
  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  extras: E;
}> & { _G?: G; _E?: E; _S?: S; _T?: T };

const BuilderTypeId: unique symbol = Symbol.for("~open-insight/eval/task/Builder");

/** A task definition that is still being assembled. Complete it with {@link build}. */
export type Builder<
  G extends Grade.Result = Grade.Result,
  E extends object = object,
  S extends Grade.Results = Grade.Results,
  T extends Template.Any = Template.Template<Grade.ResultSchema<G>, Template.JsonObjectSchema<E>>,
> = Task<G, E, S, T> &
  Readonly<{
    [BuilderTypeId]: Types.Invariant<T>;
  }>;

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

type ExtrasOptions<ES extends Template.JsonObjectSchema> = BaseOptions &
  Readonly<{
    extras: ES["Encoded"];
  }>;

export type Options<T extends Template.Any> = T["extras"] extends typeof Template.EmptyExtras
  ? NoExtrasOptions
  : ExtrasOptions<T["extras"]>;

const decodeMetadata = (options: BaseOptions) =>
  Schema.decodeEffect(BaseMetadata)(options).pipe(Effect.mapError(Error.metadata));

export const make = Effect.fn("Task.make")(function* <T extends Template.Any>(
  template: T,
  options: Options<T>,
): Effect.fn.Return<
  Builder<never, Template.Extras<T>, never, T>,
  Error,
  Crypto.Crypto | Scope.Scope
> {
  const { snapshot, resources = Resource.Resources.make({}) } = options;
  const metadata = yield* decodeMetadata(options);
  const extrasInput = "extras" in options ? options.extras : {};
  const extras = yield* Schema.decodeUnknownEffect(template.extras)(extrasInput).pipe(
    Effect.mapError(Error.metadata),
  );
  return {
    metadata,
    snapshot,
    resources,
    template,
    extras,
    stages: [],
    metrics: [],
    trajMetrics: [],
    [BuilderTypeId]: (value) => value,
  } satisfies Builder<never, Template.Extras<T>, never, T>;
});

/** Completes a task builder whose final stage result conforms to its template. */
export const build = <
  T extends Template.Any,
  G extends Template.GradeResult<T>,
  E extends object,
  S extends Grade.Results,
  Err,
  R,
>(
  self: Effect.Effect<Builder<G, E, S, T>, Err, R>,
): Effect.Effect<Task<G, E, S, T>, Err, R> => self;

export const metadata = <
  G extends Grade.Result,
  E extends object,
  S extends Grade.Results,
  T extends Template.Any,
>(
  task: Task<G, E, S, T>,
): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: Schema.encodeSync(task.template.extras)(task.extras),
  });

export const metadataSchema = <
  G extends Grade.Result,
  E extends object,
  S extends Grade.Results,
  T extends Template.Any,
>(
  task: Task<G, E, S, T>,
) =>
  Schema.Struct({
    base: BaseMetadata,
    stages: Schema.Array(StageMetadata),
    extras: Schema.toEncoded(task.template.extras),
  });
