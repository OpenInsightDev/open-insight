import { Effect, FileSystem, Path } from "effect";
import * as Task from "../index.ts";
import picomatch from "picomatch";
import { TaskError } from "../error.ts";
import { Sandbox } from "@open-insight/core/internal";
import type { Loader } from "./index.ts";

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

    return taskFiles.map((taskFile) =>
      Effect.gen(function* () {
        const context = Sandbox.Context.makeDir(path.dirname(taskFile));

        const fileUrl = yield* path.toFileUrl(taskFile).pipe(Effect.mapError(TaskError.load));
        const module = yield* Effect.tryPromise({
          try: () => import(fileUrl.href),
          catch: TaskError.load,
        });

        if (module.default === null) {
          return yield* Effect.fail(
            TaskError.load(
              new Error(
                `Loading task from file requires a default export, but the module at ${taskFile} does not export any.`,
              ),
            ),
          );
        }

        return { ...module.default, context } satisfies T;
      }),
    );
  });
