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
  /** Grade result. */
  G extends Grade.Result = Grade.Result,
  /** Task extras. */
  X extends object = object,
  /** Task template. */
  T extends Template.Unknown = Template.Template<Grade.ResultSchema<G>, Template.ExtrasSchema<X>>,
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
  extras: X;
}> & { _G?: G };

/** @internal */
export const BuilderTypeId: unique symbol = Symbol.for("~open-insight/eval/task/Builder");

/**
 * A task definition that is still being assembled. Complete it with {@link build}.
 *
 * Builders track their changing grade through {@link BuilderTypeId}; `_G` is only for built tasks.
 */
export type Builder<
  /** Current grade result. */
  G extends Grade.Result = Grade.Result,
  /** Task extras. */
  X extends object = object,
  /** Stage results. */
  S extends Grade.Results = Grade.Results,
  /** Task template. */
  T extends Template.Unknown = Template.Template<Grade.ResultSchema<G>, Template.ExtrasSchema<X>>,
> = Omit<Task<G, X, T>, "_G"> &
  Readonly<{
    [BuilderTypeId]: Types.Invariant<readonly [G, X, S, T]>;
  }>;

export type Array<
  G extends Grade.Result = Grade.Result,
  X extends object = EmptyRecord,
> = ReadonlyArray<Task<G, X>>;

type BaseOptions = BaseMetadataEncoded &
  Readonly<{
    snapshot: Snapshot.Snapshot;
    resources?: Resource.Resources;
  }>;

type NoExtrasOptions = BaseOptions &
  Readonly<{
    extras?: never;
  }>;

type ExtrasOptions<ES extends Template.ExtrasSchema> = BaseOptions &
  Readonly<{
    extras: ES["Encoded"];
  }>;

export type Options<T extends Template.Unknown> = T["Extras"] extends typeof Template.EmptyExtras
  ? NoExtrasOptions
  : ExtrasOptions<T["Extras"]>;

const decodeMetadata = (options: BaseOptions) =>
  Schema.decodeEffect(BaseMetadata)(options).pipe(Effect.mapError(Error.metadata));

export const make = <T extends Template.Unknown>(template: T) =>
  Effect.fn("Task.make")(function* (
    options: Options<T>,
  ): Effect.fn.Return<
    Builder<never, Template.Extras<T>, never, T>,
    Error,
    Crypto.Crypto | Scope.Scope
  > {
    const { snapshot, resources = Resource.make({}) } = options;
    const metadata = yield* decodeMetadata(options);
    const extrasInput = "extras" in options ? options.extras : {};
    const extras = yield* Schema.decodeUnknownEffect(template.Extras)(extrasInput).pipe(
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
  T extends Template.Unknown,
  G extends Template.GradeResult<T>,
  X extends object,
  S extends Grade.Results,
  E,
  R,
>(
  self: Effect.Effect<Builder<G, X, S, T>, E, R>,
): Effect.Effect<Task<G, X, T>, E, R> => self;

export const metadata = <G extends Grade.Result, X extends object, T extends Template.Unknown>(
  task: Task<G, X, T>,
): Metadata =>
  Metadata.make({
    base: task.metadata,
    stages: task.stages.map((stage) => stage.metadata),
    extras: Schema.encodeSync(task.template.Extras)(task.extras),
  });

export const metadataSchema = <
  G extends Grade.Result,
  X extends object,
  T extends Template.Unknown,
>(
  task: Task<G, X, T>,
) =>
  Schema.Struct({
    base: BaseMetadata,
    stages: Schema.Array(StageMetadata),
    extras: Schema.toEncoded(task.template.Extras),
  });

export type { ExtrasSchema } from "./template.ts";
