import { Sandbox, Trajectory } from "@open-insight/core/internal";
import { DateTime, Effect, Schema, Stream } from "effect";
import { MetricError } from "../error.ts";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { Metric } from "../metric.ts";

type Options = MetadataEncoded & Readonly<{}>;
type Source = Readonly<{ timestamp: DateTime.Utc; partID?: string }>;

export const make = Effect.fn(function* <S extends Schema.Constraint, E, R>(
  id: string,
  schema: S,
  mapOption: (
    trajectory: Trajectory.Trajectory,
  ) => Stream.Stream<S["Type"], E, R | Sandbox.Current>,
  options: Options = {},
) {
  const metadata = Schema.decodeSync(Metadata)(options);
  const decode = Schema.decodeUnknownEffect(Schema.toType(Result(schema)));
  const context = yield* Effect.context<R>();

  const map = ((trajectory) =>
    Stream.suspend(() => {
      let source: Source | undefined;
      const tracked = new Trajectory.Trajectory<Record<string, never>>({
        toolkit: trajectory.toolkit,
        parts: trajectory.parts.pipe(
          Stream.rechunk(1),
          Stream.tap((part) =>
            Effect.sync(() => {
              source = {
                timestamp: part.timestamp,
                partID: part.uuid,
              };
            }),
          ),
        ),
      });

      return mapOption(tracked).pipe(
        Stream.mapEffect((result) =>
          source === undefined
            ? Effect.fail(new Error("Metric emitted a result before consuming a trajectory part"))
            : decode({ result, id, ...source }),
        ),
        Stream.mapError(MetricError.transform),
        Stream.provideContext(context),
      );
    })) satisfies Metric<S>["map"];

  return new Metric({ id, schema, metadata, map });
});
