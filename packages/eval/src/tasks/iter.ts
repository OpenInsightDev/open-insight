import { Effect, Scope, Stream } from "effect";
import type { Task, Tasks } from "#/task/build.ts";
import type { TaskError } from "#/task/error.ts";

export const fromArray = <T extends Task>(
  arr: ReadonlyArray<T & Disposable>,
): Effect.Effect<Tasks<T>> =>
  Effect.sync(() => arr.map((task) => Effect.acquireDisposable(Effect.succeed(task))));

export const fromIter = <T extends Task>(iter: Iterable<T & Disposable>): Effect.Effect<Tasks<T>> =>
  fromArray(Array.from(iter));

export const fromAsyncIter = <T extends Task>(
  iter: AsyncIterable<T & Disposable>,
): Effect.Effect<Tasks<T>> =>
  Effect.promise(async () => {
    const array = await Array.fromAsync(iter);
    return array.map((task) => Effect.acquireDisposable(Effect.succeed(task)));
  });

export const fromStream = <T extends Task>(
  stream: Stream.Stream<Effect.Effect<T, TaskError, Scope.Scope>>,
): Effect.Effect<Tasks<T>> => stream.pipe(Stream.runCollect);
