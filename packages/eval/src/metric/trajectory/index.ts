import { Sandbox, Trajectory } from "@open-insight/core/internal";
import { Data, Effect, flow, Schema, Stream } from "effect";
import { MetricError } from "../error.ts";
import { Metadata, type MetadataEncoded } from "../schema.ts";

export class Metric<ID extends string, S extends Schema.Constraint> extends Data.Class<{
  id: ID;
  schema: S;
  metadata: Metadata;

  transform: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<S["Type"], MetricError, Sandbox.Current>;
}> {}
export type Any = Metric<any, any>;

type Options = MetadataEncoded & Readonly<{}>;

export const make = Effect.fn(function* <ID extends string, S extends Schema.Constraint, E, R>(
  id: ID,
  schema: S,
  transform: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<S["Type"], E, R | Sandbox.Current>,
  options: Options = {},
) {
  const metadata = Schema.decodeSync(Metadata)(options);
  const ctx = yield* Effect.context<R>();

  return new Metric({
    id,
    schema,
    metadata,
    transform: flow(transform, Stream.mapError(MetricError.transform), Stream.provide(ctx)),
  });
});
