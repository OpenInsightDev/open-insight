import { Effect, FileSystem, Path } from "effect";
import { Error } from "../error.ts";
import { makeTask } from "./index.ts";

/** Loads one Harbor task or recursively discovers Harbor tasks below a directory. */
export const fromDir = Effect.fn("Task.Load.fromHarborDir")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(dir);

  if (yield* fs.exists(path.join(root, "task.toml")).pipe(Effect.mapError(Error.source))) {
    return [yield* makeTask(root)];
  }

  const entries = yield* fs
    .readDirectory(root, { recursive: true })
    .pipe(Effect.mapError(Error.source));
  const taskDirs = Array.from(
    new Set(
      entries
        .filter((entry) => path.basename(entry) === "task.toml")
        .map((entry) => path.dirname(path.join(root, entry))),
    ),
  ).sort();

  return yield* Effect.all(taskDirs.map(makeTask), { concurrency: "unbounded" });
});
