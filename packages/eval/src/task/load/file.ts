import { Effect, FileSystem, Path } from "effect";
import * as Task from "../index.ts";
import picomatch from "picomatch";
import { TaskError } from "../error.ts";
import type { Loader } from "./index.ts";

/**
 * Discovers task modules from a directory.
 *
 * Each discovered script is treated as a task module:
 * - export its built task via default export
 * - be safe to load from any working directory
 *
 * Note: If the script contains any file system operations, e.g. `fs.readFileSync`, it must use `import.meta.dirname` or `import.meta.url` to resolve the absolute path of the task directory. Using relative paths will lead to unexpected results.
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
      .readDirectory(dir, {
        recursive: true,
      })
      .pipe(Effect.mapError(TaskError.load));

    const matcher = picomatch(glob);
    const taskFiles = entries
      .filter((entry) => matcher(path.relative(dir, entry)))
      .map((entry) => path.join(dir, entry));

    return yield* Effect.all(
      taskFiles.map((taskFile) =>
        Effect.gen(function* () {
          const fileUrl = yield* path.toFileUrl(taskFile).pipe(Effect.mapError(TaskError.load));
          const module = yield* Effect.tryPromise(() => import(fileUrl.href)).pipe(
            Effect.mapError(TaskError.load),
          );

          if (module.default === null) {
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
