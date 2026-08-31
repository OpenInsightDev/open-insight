import { Effect, Match, Schema, Stream } from "effect";
import { Tool, Toolkit, Response } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";
import { Part, Trajectory, TrajectoryEncoded } from "./trajectory.ts";

export const encode = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
) {
  const partSchema = Part(trajectory.toolkit);
  const encodingContext = yield* Effect.context<typeof partSchema.EncodingServices>();
  const encodePart = Schema.encodeEffect(partSchema);

  const parts = trajectory.parts.pipe(
    Stream.mapEffect((part) =>
      encodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(encodingContext),
      ),
    ),
  );

  return new TrajectoryEncoded({ parts });
});

export const decode = Effect.fn(function* <Toolkits extends ReadonlyArray<Toolkit.Any>>(
  trajectory: TrajectoryEncoded,
  ...toolkits: Toolkits
) {
  const toolkit = Toolkit.merge(...toolkits);
  const partSchema = Part(toolkit);
  const decodingContext = yield* Effect.context<typeof partSchema.DecodingServices>();
  const decodePart = Schema.decodeEffect(partSchema);

  const parts = trajectory.parts.pipe(
    Stream.mapEffect((part) =>
      decodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(decodingContext),
      ),
    ),
  );

  return new Trajectory<Toolkit.MergedTools<Toolkits>>({ toolkit, parts });
});

export const toolkits = <Toolkits extends ReadonlyArray<Toolkit.Any>>(...toolkits: Toolkits) =>
  Effect.fn(function* <Tools extends Record<string, Tool.Any>>(trajectory: Trajectory<Tools>) {
    const merged = Toolkit.merge(trajectory.toolkit, ...toolkits);

    const sourceSchema = Response.PartView(trajectory.toolkit);
    const partSchema = Response.PartView(merged);
    const trajectoryPart = Part(merged);
    const encode = Schema.encodeEffect(sourceSchema);
    const decode = Schema.decodeEffect(partSchema);
    const context = yield* Effect.context<
      typeof sourceSchema.EncodingServices | typeof partSchema.DecodingServices
    >();

    const parts = trajectory.parts.pipe(
      Stream.mapEffect((part) =>
        Match.value(part).pipe(
          Match.tag("Prompt", (prompt) => Effect.succeed(trajectoryPart.make(prompt))),
          Match.tag("Response", (response) =>
            Effect.gen(function* () {
              const encoded = yield* encode(response.response).pipe(
                Effect.mapError(TrajectoryError.decode),
              );
              const decoded = yield* decode(encoded).pipe(Effect.mapError(TrajectoryError.decode));
              return trajectoryPart.make({ response: decoded });
            }),
          ),
          Match.exhaustive,
        ),
      ),
      Stream.provideContext(context),
    );

    return new Trajectory({ toolkit: merged, parts });
  });
