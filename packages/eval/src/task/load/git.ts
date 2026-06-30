import * as Task from "../index.ts";
import { ChildProcess } from "effect/unstable/process";
import { Effect, FileSystem } from "effect";
import { Spawn } from "@open-insight/utils";
import type { Loader } from "./index.ts";
import { TaskError } from "../error.ts";

interface Options {
  /** Branch or tag name to checkout. */
  readonly branch?: string;
  /** Specific commit hash to checkout after cloning. */
  readonly commit?: string;
  /** Clone depth. Defaults to 1. Leave undefined for a full clone. */
  readonly depth?: number;
  /** Only fetch the specified branch. Defaults to `true` when `branch` is set. */
  readonly singleBranch?: boolean;
}

export const withGitRepo = (repoURL: string, options?: Options) =>
  Effect.fn(function* <T extends Task.Task>(
    exec: (repoPath: string) => Loader<T> | Promise<Loader<T>>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.SpawnService;

    const repoPath = yield* fs.makeTempDirectoryScoped({
      prefix: "open-insight-task-",
    });

    const cloneArgs: Array<string> = ["clone"];

    const depth = options?.depth ?? 1;
    if (depth !== undefined && Number.isFinite(depth)) {
      cloneArgs.push("--depth", String(depth));
    }

    if (options?.branch) {
      cloneArgs.push("--branch", options.branch);
    }

    const singleBranch = options?.singleBranch ?? options?.branch !== undefined;
    if (singleBranch) {
      cloneArgs.push("--single-branch");
    }

    cloneArgs.push(repoURL, repoPath);

    const clone = ChildProcess.make("git", cloneArgs);
    yield* spawner.exitCode(clone);

    // Checkout a specific commit after clone if requested
    if (options?.commit) {
      const checkout = ChildProcess.make("git", ["-C", repoPath, "checkout", options.commit]);
      yield* spawner.exitCode(checkout);
    }

    const loader = yield* Effect.tryPromise({
      try: () => Promise.resolve(exec(repoPath)),
      catch: TaskError.load,
    });
    return yield* loader;
  });
