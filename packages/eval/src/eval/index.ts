import { Cause, Effect, FileSystem, Path, Stream } from "effect";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Config from "./config.ts";
import { make as makeEventStream } from "./bench.ts";
import type { BenchResult } from "./result.ts";
import type { Harness, Sandbox } from "@open-insight/core/internal";

export const make =
  (configOptions: Partial<Config.Config> = {}) =>
  <T extends Task.AnyTask>(bench: Bench.Bench<T>) =>
    makeEventStream(bench, Config.make(configOptions)).pipe(
      Stream.mapError((done) => done as Cause.Done<BenchResult<Task.GradeOf<T>>>),
    ) satisfies Stream.Stream<
      Event.EvalEvent,
      Event.EvalErrorEvent | Cause.Done<BenchResult<Task.GradeOf<T>>>,
      FileSystem.FileSystem | Path.Path | Harness.Service | Sandbox.ProviderService
    >;

export const result = <T extends Task.AnyTask, R>(
  stream: Stream.Stream<
    Event.EvalEvent,
    Event.EvalErrorEvent | Cause.Done<BenchResult<Task.GradeOf<T>>>,
    R
  >,
) =>
  stream.pipe(
    Stream.runCollect,
    Effect.andThen(Effect.never),
    Effect.catchTag("Done", ({ value: result }) => Effect.succeed(result)),
    Effect.mapError(({ error }) => error as EvalError),
  );

export * from "./error.ts";
export * from "./result.ts";
