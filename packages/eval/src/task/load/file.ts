import { Effect, FileSystem, Path } from "effect";
import * as Task from "../index.ts";
import picomatch from "picomatch";
import { TaskError } from "../error.ts";
import type { Loader } from "./index.ts";

/**
 * Discovers task modules from a directory.
 *
 * Each discovered script is treated as a task module:
 * - export its task via default export
 * - be safe to load from any working directory.
 * That is, if the script contains any file system operations, e.g. `fs.readFileSync`, the file path must be resolved using `import.meta.resolve(filePath)`.
 * Using relative paths without resolving will lead to unexpected results.
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

    const entries = yield* fs
      .readDirectory(dir, { recursive: true })
      .pipe(Effect.mapError(TaskError.load));

    const matcher = picomatch(glob);
    const taskFiles = entries
      .filter((entry) => matcher(path.relative(dir, entry)))
      .map((entry) => path.join(dir, entry));

    return yield* Effect.all(
      taskFiles.map(
        Effect.fn(function* (taskFile) {
          const module = yield* Effect.tryPromise(() => import(taskFile)).pipe(
            Effect.mapError(TaskError.load),
          );

          if (!module.default) {
            return yield* Effect.fail(
              TaskError.load(
                new Error(
                  `Loading task from file requires a default export, but the module at ${taskFile} does not export any.`,
                ),
              ),
            );
          }

          if (module.default[Task.TypeId] !== Task.TypeId) {
            return yield* Effect.fail(
              TaskError.load(
                new Error(
                  `Loading task from file requires a default export of type Task, but the module at ${taskFile} exports a value that is not a valid Task.`,
                ),
              ),
            );
          }

          return Effect.succeed(module.default as T);
        }),
      ),
      { concurrency: "unbounded" },
    );
  });
