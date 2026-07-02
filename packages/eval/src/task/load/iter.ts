import { Effect, type Scope, Stream } from "effect";
import type * as Task from "../index.ts";
import type { Loader, Tasks } from "./index.ts";
import { TaskError } from "../error.ts";

type DisposableTaskPromise<T extends Task.Task> = PromiseLike<Task.BuiltTask<T>> & AsyncDisposable;

type TaskSource<T extends Task.Task> = Task.BuiltTask<T> | DisposableTaskPromise<T>;

const resolveTask = <T extends Task.Task>(
  value: DisposableTaskPromise<T>,
): Effect.Effect<Task.BuiltTask<T>, TaskError, Scope.Scope> =>
  Effect.acquireDisposable(Effect.succeed(value)).pipe(
    Effect.flatMap((promise) =>
      Effect.tryPromise({
        try: () => Promise.resolve(promise),
        catch: TaskError.load,
      }),
    ),
  );

// FIXME
const isTaskPromise = <T extends Task.Task>(
  value: TaskSource<T>,
): value is DisposableTaskPromise<T> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

const toTaskEffect = <T extends Task.Task>(value: TaskSource<T>): Task.BuiltTask<T> =>
  (isTaskPromise(value) ? resolveTask(value) : Effect.succeed(value)).pipe(
    Effect.flatMap((effect) => effect),
  );

export const fromArray = <T extends Task.Task>(tasks: ReadonlyArray<TaskSource<T>>): Loader<T> =>
  Effect.succeed(tasks.map(toTaskEffect) as Tasks<T>);

export const fromIterable = <T extends Task.Task>(iterable: Iterable<TaskSource<T>>): Loader<T> =>
  Effect.sync(() => Array.from(iterable, toTaskEffect) as Tasks<T>);

export const fromAsyncIterable = <T extends Task.Task>(
  iterable: AsyncIterable<TaskSource<T>>,
): Loader<T> =>
  Effect.tryPromise({
    try: async () => {
      const tasks: Task.BuiltTask<T>[] = [];
      const iterator = iterable[Symbol.asyncIterator]();
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        tasks.push(toTaskEffect(result.value));
      }
      return tasks as Tasks<T>;
    },
    catch: TaskError.load,
  });

export const fromStream = <T extends Task.Task, E, R>(
  stream: Stream.Stream<TaskSource<T>, E, R>,
): Loader<T, R, E> =>
  stream.pipe(
    Stream.map(toTaskEffect),
    Stream.runCollect,
    Effect.map((tasks) => Array.from(tasks) as Tasks<T>),
  );
