import { Effect, Stream } from "effect";
import type * as Task from "../index.ts";
import type { Loader, Tasks } from "./index.ts";
import { TaskError } from "../error.ts";

const toTaskEffect = <T extends Task.Task>(
  value: Task.BuiltTask<T> | Promise<Task.BuiltTask<T>>,
): Task.BuiltTask<T> =>
  Effect.tryPromise({
    try: () => Promise.resolve(value),
    catch: TaskError.load,
  }).pipe(Effect.flatMap((effect) => effect));

export const fromArray = <T extends Task.Task>(
  tasks: ReadonlyArray<Task.BuiltTask<T> | Promise<Task.BuiltTask<T>>>,
): Loader<T> => Effect.succeed(tasks.map(toTaskEffect) as Tasks<T>);

export const fromIterable = <T extends Task.Task>(
  iterable: Iterable<Task.BuiltTask<T> | Promise<Task.BuiltTask<T>>>,
): Loader<T> => Effect.sync(() => Array.from(iterable, toTaskEffect) as Tasks<T>);

export const fromAsyncIterable = <T extends Task.Task>(
  iterable: AsyncIterable<Task.BuiltTask<T> | Promise<Task.BuiltTask<T>>>,
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
  stream: Stream.Stream<Task.BuiltTask<T> | Promise<Task.BuiltTask<T>>, E, R>,
): Loader<T, R, E> =>
  stream.pipe(
    Stream.map(toTaskEffect),
    Stream.runCollect,
    Effect.map((tasks) => Array.from(tasks) as Tasks<T>),
  );
