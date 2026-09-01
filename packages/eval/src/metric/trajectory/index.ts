import { Sandbox, Trajectory } from "@open-insight/core/internal";

import { Effect, Schema, Stream } from "effect";
import { MetricError } from "../error.ts";
import { Metadata, Metric, type Result, type MetadataEncoded } from "../metric.ts";

type Options = MetadataEncoded & Readonly<{}>;
type Observation<S extends Schema.Constraint> = Readonly<{
  result: S["Type"];
  part: Trajectory.ResponsePart<any>;
}>;

export const make = Effect.fn(function* <S extends Schema.Constraint, E, R>(
  id: string,
  schema: S,
  transformOption: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<Observation<S>, E, R | Sandbox.Current>,
  options: Options = {},
) {
  const metadata = Schema.decodeSync(Metadata)(options);
  const context = yield* Effect.context<R>();

  return new Metric({
    id,
    schema,
    metadata,
    transform: (trajectory) =>
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
        Stream.provideContext(context),
        Stream.mapError(MetricError.transform),
      ),
  });
});
