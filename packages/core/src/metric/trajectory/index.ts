import * as Sandbox from "#/sandbox/index.ts";
import * as Trajectory from "#/trajectory/index.ts";

import { Schema, Stream } from "effect";
import { MetricError } from "../error.ts";
import { Metadata, Metric, type Result, type MetadataEncoded } from "../metric.ts";

type Options = MetadataEncoded & Readonly<{}>;
type Observation<S extends Schema.Constraint> = Readonly<{
  result: S["Type"];
  part: Trajectory.ResponsePart<any>;
}>;

export const make = <ID extends string, S extends Schema.Constraint>(
  id: ID,
  schema: S,
  transform: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<Observation<S>, unknown, Sandbox.Current>,
  options: Options = {},
) => {
  const metadata = Schema.decodeSync(Metadata)(options);

  return new Metric({
    id,
    schema,
    metadata,
    transform: (sessions) =>
      sessions.pipe(
        Stream.flatMap(({ trajectory }) =>
          transform(trajectory).pipe(
            Stream.map(
              ({ result, part: { timestamp, uuid } }) =>
                ({
                  id,
                  result,
                  timestamp,
                  partID: uuid,
                }) satisfies Result<ID, S>,
            ),
          ),
        ),
        Stream.mapError(MetricError.transform),
      ),
  });
};
