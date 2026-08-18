import { Effect, Sink } from "effect";
import type { TrailResult } from "./result.ts";
import type { TrailSuccessEvent } from "./schema.ts";

export const makeSession = () =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);

export const makeTrail = (): Sink.Sink<TrailResult, TrailSuccessEvent> =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);
