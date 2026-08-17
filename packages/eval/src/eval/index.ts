import { Cause, Effect, Stream } from "effect";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Config from "./config.ts";
import { make as makeStream } from "./stream.ts";
import { EvalError } from "./error.ts";

type EventStream<T extends Task.AnyTask = Task.AnyTask, R = never> = Stream.Stream<
  Event.EvalEvent,
  Event.EvalErrorEvent | Cause.Done<Event.BenchResult<Task.GradeOf<T>>>,
  R
>;

export const make =
  <T extends Task.AnyTask>(configOptions: Partial<Config.Config> = {}) =>
  (bench: Bench.Bench<T>) =>
    makeStream<T>(bench, Config.make(configOptions)).pipe(
      Stream.catchTag("Done", (done) =>
        Stream.fail(done as Cause.Done<Event.BenchResult<Task.GradeOf<T>>>),
      ),
    );

export const run = <T extends Task.AnyTask>(
  bench: Bench.Bench<T>,
  configOptions: Partial<Config.Config> = {},
) => make<T>(configOptions)(bench);

export const stream = <T extends Task.AnyTask, R>(
  stream: EventStream<T, R>,
): Stream.Stream<Event.EvalEvent, never, R> =>
  stream.pipe(
    Stream.catchTag("Done", () => Stream.empty),
    Stream.catch((event) => Stream.succeed(event)),
  );

export const result = <T extends Task.AnyTask, R>(
  stream: EventStream<T, R>,
): Effect.Effect<Event.BenchResult<Task.GradeOf<T>>, EvalError, R> =>
  stream.pipe(
    Stream.runDrain,
    Effect.andThen(
      Effect.die("Stream should either succeed with `Cause.Done` or fail with `EvalError`."),
    ),
    Effect.catchTag("Done", ({ value: result }) => Effect.succeed(result)),
    Effect.mapError(({ error }) => error as EvalError),
  );

export * from "./error.ts";
