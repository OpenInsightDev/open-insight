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

export const make = <S extends Schema.Constraint>(
  id: string,
  schema: S,
  transformOption: (
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
          transformOption(trajectory).pipe(
            Stream.map(
              ({ result, part }) =>
                ({
                  id,
                  result,
                  timestamp: part.timestamp,
                  partID: part.uuid,
                }) satisfies Result<S>,
            ),
          ),
        ),
        Stream.mapError(MetricError.transform),
      ),
  });
};
