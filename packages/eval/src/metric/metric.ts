import { Sandbox, Trajectory } from "@open-insight/core/internal";
import type { MetricError } from "./error.ts";
import { Data, DateTime, Schema, Stream } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export const Result = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({
    result: schema,

    /**
     * Metric ID.
     */
    id: Schema.String,

    /**
     * Timestamp when the metric value is emitted.
     */
    timestamp: Schema.DateTimeUtcFromString,

    /**
     * Associated trajectory part ID, if any.
     *
     * Available when the metric value is emitted according to a specific trajectory part.
     */
    partID: Schema.optional(Schema.String),
  });

export type Result<S extends Schema.Constraint> = Readonly<{
  result: S["Type"];
  id: string;
  timestamp: DateTime.Utc;
  partID?: string;
}>;

export class Metric<S extends Schema.Constraint> extends Data.Class<{
  id: string;
  schema: S;
  metadata: Metadata;

  transform: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<Result<S>, MetricError, Sandbox.Current>;
}> {}
export type Any = Metric<any>;
