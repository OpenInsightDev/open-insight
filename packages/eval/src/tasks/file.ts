import { Effect, FileSystem, Path, Predicate, Scope } from "effect";
import * as Task from "#/task/index.ts";
import picomatch from "picomatch";
import { Error as TasksError } from "./error.ts";
import type { Loader } from "./index.ts";

const missingDefaultExport = (taskFile: string) =>
  TasksError.invalid(
    new Error(
      `Loading task from file requires a default export, but the module at ${taskFile} does not export any.`,
    ),
  );

const invalidDefaultExport = (taskFile: string) =>
  TasksError.invalid(
    new Error(
      `Loading task from file requires a default export of type Task, but the module at ${taskFile} exports a value that is not a valid Task.`,
    ),
  );

const hasTaskTypeId = <T extends Task.Task>(value: unknown): value is T =>
  Predicate.hasProperty(value, Task.TypeId) && value[Task.TypeId] === Task.TypeId;

const verifyTask = <T extends Task.Task>(taskFile: string, value: unknown) =>
  hasTaskTypeId<T>(value) ? Effect.succeed(value) : Effect.fail(invalidDefaultExport(taskFile));

const loadTaskFactory = <T extends Task.Task>(taskFile: string, factory: () => unknown) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const value = yield* Effect.tryPromise({
        try: () => Promise.resolve(factory()),
        catch: TasksError.init,
      });
      const task = yield* verifyTask<T>(taskFile, value);

      if (!Predicate.hasProperty(task, Symbol.asyncDispose)) {
        return yield* Effect.fail(invalidDefaultExport(taskFile));
      }

      const dispose = task[Symbol.asyncDispose];
      if (typeof dispose !== "function") {
        return yield* Effect.fail(invalidDefaultExport(taskFile));
      }

      return {
        task,
        dispose: (): Promise<unknown> => Promise.resolve(dispose.call(task)),
      };
    }),
    ({ dispose }) => Effect.promise(dispose),
  ).pipe(Effect.map(({ task }) => task));

/**
 * Discovers task modules from a directory.
 *
 * Each discovered script is treated as a task module:
 * - export its task via default export
 * - be safe to load from any working directory.
 * That is, if the script contains any file system operations, e.g. `fs.readFileSync`, the file path must be resolved using `import.meta.resolve(filePath)`.
 * Using relative paths without resolving will lead to unexpected results.
 *
 * Supported export modes:
 *
 * ```ts
 * import { Task } from "@open-insight/eval";
 *
 * export default Task.make({
 *   name: "static task",
 *   // ...
 * });
 * ```
 *
 * ```ts
 * import { Task } from "@open-insight/eval";
 *
 * export default async function makeTask() {
 *   const task = Task.make({
 *     name: "scoped task",
 *     // ...
 *   });
 *
 *   return Object.defineProperty(task, Symbol.asyncDispose, {
 *     value: async () => {
 *       // Clean up resources acquired while creating the task.
 *     },
 *   });
 * }
 * ```
 */
export const fromDir = <T extends Task.Task>({
  dir,
  glob = "**/index.ts",
}: {
  dir: string;
  glob?: string;
}): Loader<T, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const entries = yield* fs // must be relative paths
      .readDirectory(dir, { recursive: true })
      .pipe(Effect.mapError(TasksError.source));

    const matcher = picomatch(glob);
    const taskFiles = entries
      .filter((entry) => matcher(entry))
      .map((entry) => path.join(dir, entry));

    return yield* Effect.all(
      taskFiles.map(
        Effect.fn(function* (taskFile) {
          const module: unknown = yield* Effect.tryPromise(() => import(taskFile)).pipe(
            Effect.mapError(TasksError.source),
          );

          if (!Predicate.hasProperty(module, "default")) {
            return yield* Effect.fail(missingDefaultExport(taskFile));
          }

          const taskExport = module.default;

          if (typeof taskExport === "function") {
            return loadTaskFactory<T>(taskFile, () => taskExport());
          }

          return Effect.succeed(yield* verifyTask<T>(taskFile, taskExport));
        }),
      ),
      { concurrency: "unbounded" },
    );
  });
