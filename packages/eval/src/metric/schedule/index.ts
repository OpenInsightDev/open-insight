import { Sandbox } from "@open-insight/core/internal";
import { DateTime, Effect, Schedule, Schema, Stream } from "effect";
import { MetricError } from "../error.ts";
import { Metadata, Metric, type MetadataEncoded, type Result } from "../metric.ts";

export type Options = MetadataEncoded &
  Readonly<{
    schedule?: Schedule.Schedule<unknown>;
  }>;

const toTimestamps = (
  schedule: Schedule.Schedule<unknown>,
): Stream.Stream<DateTime.Utc, MetricError> =>
  Stream.fromSchedule(schedule).pipe(
    Stream.mapEffect(() => DateTime.now),
    Stream.mapError(MetricError.transform),
  );

export const fromSchedule = (
  schedule?: Schedule.Schedule<unknown>,
): Stream.Stream<DateTime.Utc, MetricError> =>
  schedule ? toTimestamps(schedule) : toTimestamps(Schedule.forever);

export const make = Effect.fn(function* <S extends Schema.Constraint, E, R>(
  id: string,
  schema: S,
  transform: (
    sched: Stream.Stream<DateTime.DateTime, MetricError>,
  ) => Stream.Stream<S["Type"], E, R | Sandbox.Current>,
  options: Options = {},
) {
  const metadata = Schema.decodeSync(Metadata)(options);
  const context = yield* Effect.context<R>();
  const schedule = fromSchedule(options.schedule);

  return new Metric({
    id,
    schema,
    metadata,
    transform: () =>
      transform(schedule).pipe(
        Stream.mapEffect((result) =>
          DateTime.now.pipe(
            Effect.map((timestamp) => ({ id, result, timestamp }) satisfies Result<S>),
          ),
        ),
        Stream.provideContext(context),
        Stream.mapError(MetricError.transform),
      ),
  });
});
