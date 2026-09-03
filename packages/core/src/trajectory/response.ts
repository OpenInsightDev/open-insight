import { Effect, Option, Sink, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import type { Part, Trajectory } from "./trajectory.ts";
import type { TrajectoryError } from "./error.ts";
import { responses } from "./view.ts";

/**
 * Sink that extracts the last finish part from a response stream.
 */
export const finishPart: Sink.Sink<Option.Option<Response.FinishPart>, Part<any>> = Sink.reduce(
  () => Option.none<Response.FinishPart>(),
  (state, part) =>
    part._tag === "Response" && part.response.type === "finish"
      ? Option.some(part.response)
      : state,
);

export const usage = (
  trajectory: Trajectory<any>,
): Effect.Effect<Option.Option<Response.Usage>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.usage)),
  );

export const finishReason = (
  trajectory: Trajectory<any>,
): Effect.Effect<Option.Option<Response.FinishReason>, TrajectoryError> =>
  trajectory.pipe(
    Stream.run(finishPart),
    Effect.map((part) => Option.map(part, (p) => p.reason)),
  );

export const responseMetadataParts = (
  trajectory: Trajectory<any>,
): Stream.Stream<Response.ResponseMetadataPart, TrajectoryError> =>
  trajectory.pipe(responses).pipe(Stream.filter((part) => part.type === "response-metadata"));
