import { DateTime, Effect, Schema, Stream } from "effect";
import { Sandbox } from "@open-insight/core/internal";
import type { MetricError } from "../error.ts";
import { Metadata, type MetadataEncoded } from "../schema.ts";

export type Metric<ID extends string, S extends Schema.Constraint> = Readonly<{
  id: ID;
  schema: S;
  metadata: Metadata;
  repeat: Effect.Repeat.Options<unknown>;
  map(time: Stream.Stream<DateTime.DateTime>): Stream.Stream<S["Type"], MetricError>;
}>;

export type Options = MetadataEncoded & Effect.Repeat.Options<unknown> & Readonly<{}>;

export const make = Effect.fn(function* <ID extends string, S extends Schema.Constraint>(
  id: ID,
  schema: S,
  map: (time: DateTime.DateTime) => Effect.Effect<S["Type"], unknown, Sandbox.Current>,
  options: Options = {},
) {
  const metadata = Schema.decodeSync(Metadata)(options);
});
