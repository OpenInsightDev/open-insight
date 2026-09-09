import { Effect, Schema, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";
import { Part, type Trajectory, type PartEncoded } from "./trajectory.ts";

export type TrajectoryEncoded = Stream.Stream<PartEncoded, TrajectoryError>;

export const encode = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Effect.fn.Return<
  TrajectoryEncoded,
  TrajectoryError,
  Tool.ResultEncodingServices<Tools[keyof Tools]>
> {
  const partSchema = Part(trajectory.toolkit);
  const encodingContext = yield* Effect.context<typeof partSchema.EncodingServices>();
  const encodePart = Schema.encodeEffect(partSchema);

  const parts = trajectory.pipe(
    Stream.mapEffect((part) =>
      encodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(encodingContext),
      ),
    ),
  );

  return parts;
}, Stream.unwrap);

export const decode = Effect.fn(function* <Toolkits extends ReadonlyArray<Toolkit.Any>>(
  trajectory: TrajectoryEncoded,
  ...toolkits: Toolkits
) {
  const toolkit = Toolkit.merge(...toolkits);
  const partSchema = Part(toolkit);
  const decodingContext = yield* Effect.context<typeof partSchema.DecodingServices>();
  const decodePart = Schema.decodeEffect(partSchema);

  const parts = trajectory.pipe(
    Stream.mapEffect((part) =>
      decodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(decodingContext),
      ),
    ),
  );

  return Object.assign(parts, { toolkit }) as Trajectory<Toolkit.MergedTools<Toolkits>>;
});
