import { Effect, Stream } from "effect";
import type * as Task from "../index.ts";
import type { Loader, Tasks } from "./index.ts";
import { TaskError } from "../error.ts";

type TaskEffect<T extends Task.Task> = Effect.Effect<T, TaskError>;

const toTasks = <T extends Task.Task>(tasks: Iterable<TaskEffect<T>>): Tasks<T> =>
  Array.from(tasks);

export const fromArray = <T extends Task.Task>(tasks: ReadonlyArray<TaskEffect<T>>): Loader<T> =>
  Effect.succeed(toTasks(tasks));

export const fromIterable = <T extends Task.Task>(iterable: Iterable<TaskEffect<T>>): Loader<T> =>
  Effect.sync(() => toTasks(iterable));

export const fromAsyncIterable = <T extends Task.Task>(
  iterable: AsyncIterable<TaskEffect<T>>,
): Loader<T> =>
  Effect.tryPromise({
    try: () => Array.fromAsync(iterable) as Promise<Tasks<T>>,
    catch: TaskError.load,
  }).pipe(Effect.map((tasks) => tasks as Tasks<T>));

export const fromStream = <T extends Task.Task, E, R>(
  stream: Stream.Stream<TaskEffect<T>, E, R>,
): Loader<T, R, E> => stream.pipe(Stream.runCollect, Effect.map(toTasks));
