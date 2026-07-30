import { Crypto, Effect, FileSystem, Path, Predicate, Stdio, Terminal } from "effect";
import * as Task from "#/task/index.ts";
import picomatch from "picomatch";
import { Error as TasksError } from "./error.ts";
import type { LoadFnReturn } from "./index.ts";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { UnknownError } from "effect/Cause";

const missingDefaultExport = (taskFile: string) =>
  TasksError.invalid(
    new Error(
      `Loading task from file requires a default export, but the module at ${taskFile} does not export any.`,
    ),
  );

const invalidDefaultExport = (taskFile: string) =>
  TasksError.invalid(
    new Error(
      `Loading task from file requires a default export of type ExportTask, but the module at ${taskFile} exports a value that is not a valid Effect.`,
    ),
  );

type ExportTask<T extends Task.Task> = Effect.Effect<
  T,
  UnknownError,
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | Terminal.Terminal
  | Stdio.Stdio
>;

const isExportTask = <T extends Task.Task>(value: unknown): value is ExportTask<T> =>
  Effect.isEffect(value);

/**
 * Discovers task modules from a directory.
 *
 * Each discovered script is treated as a task module:
 * - export its task via default export
 * - be safe to load from any working directory.
 * That is, if the script contains any file system operations, e.g. `fs.readFileSync`, the file path must be resolved using `import.meta.resolve(filePath)`.
 * Using relative paths without resolving will lead to unexpected results.
 *
 * The default export must be an Effect that produces a Task:
 *
 * ```ts
 * import { Grade, Task } from "@open-insight/eval";
 *
 * const template = Task.Template.from({
 *   grade: Grade.Result,
 * });
 *
 * export default Task.make(template, {
 *   id: "static-task",
 *   name: "static task",
 *   snapshot,
 * }).pipe(
 *   Task.stage("solve", {
 *     schema: Grade.Result,
 *     prompt: "Solve the task",
 *     grader: async () => ({}),
 *   }),
 *   Task.build,
 * );
 * ```
 */
export const fromDir = Effect.fn(function* <T extends Task.Task>({
  dir,
  glob = "**/index.ts",
}: {
  dir: string;
  glob?: string;
}): LoadFnReturn<T, TasksError, Effect.Services<ExportTask<T>>> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const entries = yield* fs // must be relative paths
    .readDirectory(dir, { recursive: true })
    .pipe(Effect.mapError(TasksError.source));

  const matcher = picomatch(glob);
  const taskFiles = entries.filter((entry) => matcher(entry)).map((entry) => path.join(dir, entry));

  const exports = taskFiles.map(
    Effect.fn(function* (taskFile) {
      const module: unknown = yield* Effect.tryPromise(() => import(taskFile)).pipe(
        Effect.mapError(TasksError.source),
      );

      if (!Predicate.hasProperty(module, "default")) {
        return yield* Effect.fail(missingDefaultExport(taskFile));
      }

      const taskExport = module.default;
      if (!isExportTask<T>(taskExport)) {
        return yield* Effect.fail(invalidDefaultExport(taskFile));
      }

      return yield* taskExport.pipe(Effect.mapError(TasksError.init));
    }),
  );

  return yield* Effect.all(exports, { concurrency: "unbounded" });
});
