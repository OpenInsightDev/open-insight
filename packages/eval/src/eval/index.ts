import { Cause, Effect, FileSystem, Path, Stream } from "effect";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Config from "./config.ts";
import type { Harness, Sandbox } from "@open-insight/core/internal";
import { make as makeStream } from "./stream.ts";
import { EvalError } from "./error.ts";

type EventStream<T extends Task.AnyTask = Task.AnyTask, R = never> = Stream.Stream<
  Event.EvalEvent,
  Event.EvalErrorEvent | Cause.Done<Event.BenchResult<Task.GradeOf<T>>>,
  R
>;

export const make =
  (configOptions: Partial<Config.Config> = {}) =>
  <T extends Task.AnyTask>(bench: Bench.Bench<T>) =>
    makeStream(bench, Config.make(configOptions)).pipe(
      Stream.mapError((done) => done as Cause.Done<Event.BenchResult<Task.GradeOf<T>>>),
    ) satisfies EventStream<
      T,
      FileSystem.FileSystem | Path.Path | Harness.Service | Sandbox.ProviderService
    >;

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
