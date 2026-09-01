import { Sandbox, Trajectory } from "@open-insight/core/internal";
import type { Metadata, Result } from "./schema.ts";
import type { MetricError } from "./error.ts";
import { Data, Stream, type Schema } from "effect";

export class Metric<S extends Schema.Constraint> extends Data.Class<{
  id: string;
  schema: S;
  metadata: Metadata;

  map: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<Result<S>, MetricError, Sandbox.Current>;
}> {}

export type Any = Metric<any>;
