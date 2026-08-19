import { Effect, Schema, Stream } from "effect";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Config from "./config.ts";
import { make as makeStream } from "./stream.ts";
import { EvalError } from "./error.ts";

type EventStream<T extends Task.AnyTask = Task.AnyTask, R = never> = Stream.Stream<
  Event.EvalEvent,
  Event.EvalErrorEvent | Event.ResultDone<Event.BenchResult<Task.GradeTypeOf<T>>>,
  R
>;

const toEvalError = (error: unknown): EvalError => {
  if (Schema.is(EvalError)(error)) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    Schema.is(EvalError)(error.error)
  ) {
    return error.error;
  }
  return EvalError.init(error);
};

export const make =
  <T extends Task.AnyTask>(configOptions: Partial<Config.Config> = {}) =>
  (bench: Bench.Bench<T>) =>
    makeStream<T>(bench, Config.make(configOptions)).pipe(
      Stream.catchTag("ResultDone", (done) => Stream.fail(done)),
    );

export const run = <T extends Task.AnyTask>(
  bench: Bench.Bench<T>,
  configOptions: Partial<Config.Config> = {},
) => make<T>(configOptions)(bench);

export const stream = <T extends Task.AnyTask, R>(
  stream: EventStream<T, R>,
): Stream.Stream<Event.EvalEvent, never, R> =>
  stream.pipe(
    Stream.catchTag("ResultDone", () => Stream.empty),
    Stream.catch((event) => Stream.succeed(event)),
  );

export const result = <T extends Task.AnyTask, R>(
  stream: EventStream<T, R>,
): Effect.Effect<Event.BenchResult<Task.GradeTypeOf<T>>, EvalError, R> =>
  stream.pipe(
    Stream.runDrain,
    Effect.andThen(Effect.die("Stream completed without a ResultDone signal.")),
    Effect.catchTag("ResultDone", ({ value }) => Effect.succeed(value)),
    Effect.mapError(toEvalError),
  );

export * from "./error.ts";
