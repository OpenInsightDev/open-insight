import * as Task from "#/task/index.ts";
import { Effect, Stream } from "effect";
import type { LoadFnReturn } from "./index.ts";
import { TasksError } from "./error.ts";

export const fromIter = Effect.fn(function* <T extends Task.AnyTask, E, R>(
  iter: Iterable<Effect.Effect<T, E, R>>,
): LoadFnReturn<T, E, R> {
  const tasks = yield* Effect.all(Array.from(iter));
  return tasks;
});

export const fromAsyncIter = Effect.fn(function* <T extends Task.AnyTask, E, R>(
  iter: AsyncIterable<Effect.Effect<T, E, R>>,
): LoadFnReturn<T, E | TasksError, R> {
  const array = yield* Effect.tryPromise(() => Array.fromAsync(iter)).pipe(
    Effect.mapError(TasksError.invalid),
  );
  const tasks = yield* Effect.all(array);
  return tasks;
});

export const fromStream = Effect.fn(function* <T extends Task.AnyTask, E, R>(
  stream: Stream.Stream<T, E, R>,
): LoadFnReturn<T, E, R> {
  const tasks = yield* stream.pipe(Stream.runCollect);
  return tasks;
});
