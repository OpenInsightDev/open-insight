import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { StageMetadata, type Stage } from "./stage.ts";
import { Resource, type Snapshot } from "@open-insight/core/internal";
import type { Invariant } from "../utils/variant.ts";

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
  E extends Schema.Constraint = never,
> = Readonly<{
  metadata: BaseMetadata;
  snapshot: Snapshot.Snapshot;
  resources: Resource.Resources;

  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  stages: ReadonlyArray<Stage>;

  Extras: E;
  extras: E["Type"] | null;

  [TypeId]: TypeId;
}>;

export type Builder<
  G extends Grade.Result,
  E extends Schema.Constraint,
  SG extends Grade.Result,
> = Task<G, E> & {
  _SG?: Invariant<[SG]>;
};

export const build = <G extends Grade.Result, E extends Schema.Constraint>(
  template: Template<G, E>,
) =>
  Effect.fn(function* (
    options: Readonly<{
      snapshot: Snapshot.Snapshot;
      resources?: Resource.Resources;
      metrics?: ReadonlyArray<Metric.Task.Metric>;
      trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
      extras?: E["Encoded"];
    }> &
      BaseMetadataEncoded,
  ) {
    const {
      snapshot,
      resources = Resource.make({}),
      metrics = [],
      trajMetrics = [],
      extras: extrasEncoded = null,
    } = options;

    const metadata = yield* Schema.decodeEffect(BaseMetadata)(options);
    const extras = extrasEncoded
      ? yield* Schema.decodeEffect(template.Extras)(extrasEncoded)
      : null;

    return {
      ...template,
      metadata,
      snapshot,
      resources,
      metrics,
      trajMetrics,
      stages: [],
      extras,
      [TypeId]: TypeId,
    } satisfies Builder<G, E, never>;
  });
