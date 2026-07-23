import { Effect, Scope, Stream } from "effect";
import type { Task } from "#/task/build.ts";
import { Error } from "./error.ts";
import type { Load, Load } from "./index.ts";

export const fromArray = <T extends Task>(arr: ReadonlyArray<T & Disposable>): Load<T> =>
  Effect.sync(() => arr.map((task) => Effect.acquireDisposable(Effect.succeed(task))));

export const fromIter = <T extends Task>(
  iter: Iterable<T & Disposable>,
): Effect.Effect<Load<T>, Error> =>
  Effect.try({
    try: () => Array.from(iter),
    catch: Error.source,
  }).pipe(Effect.flatMap(fromArray));

export const fromAsyncIter = <T extends Task>(
  iter: AsyncIterable<T & Disposable>,
): Effect.Effect<Load<T>, Error> =>
  Effect.tryPromise({
    try: () => Array.fromAsync(iter),
    catch: Error.source,
  }).pipe(
    Effect.map((array) => array.map((task) => Effect.acquireDisposable(Effect.succeed(task)))),
  );

export const fromStream = <T extends Task>(
  stream: Stream.Stream<Effect.Effect<T, Error, Scope.Scope>>,
): Effect.Effect<Load<T>> => stream.pipe(Stream.runCollect);
