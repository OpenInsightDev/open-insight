import type * as Task from "../index.ts";
import { ChildProcess } from "effect/unstable/process";
import { Effect, FileSystem } from "effect";
import { Spawn } from "@open-insight/core/utils";
import type { Loader } from "./index.ts";
import { TaskError } from "../error.ts";

interface Options {
  /** Target directory. Defaults to a scoped temporary directory. */
  readonly directory?: string;
  /** Branch or tag name to checkout. */
  readonly branch?: string;
  /** Specific commit hash to checkout after cloning. */
  readonly commit?: string;
  /** Clone depth. Defaults to 1. Leave undefined for a full clone. */
  readonly depth?: number;
  /** Only fetch the specified branch. Defaults to `true` when `branch` is set. */
  readonly singleBranch?: boolean;
}

const cloneArgs = (
  repoURL: string,
  repoPath: string,
  { branch, depth = 1, singleBranch }: Omit<Options, "directory">,
): Array<string> => {
  const args: Array<string> = ["clone"];

  if (depth !== undefined && Number.isFinite(depth)) {
    args.push("--depth", String(depth));
  }

  if (branch) {
    args.push("--branch", branch);
  }

  if (singleBranch || branch) {
    args.push("--single-branch");
  }

  args.push(repoURL, repoPath);
  return args;
};

const loadGitRepo = Effect.fn(function* (repoPath: string, repoURL: string, options: Options) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* Spawn.Service;

  const run = (args: ReadonlyArray<string>) =>
    spawner.success(ChildProcess.make("git", ["-C", repoPath, ...args]));

  const git = (args: ReadonlyArray<string>) =>
    spawner
      .string(ChildProcess.make("git", ["-C", repoPath, ...args]))
      .pipe(Effect.map((s) => s.trim()));

  const targetCommit = Effect.gen(function* () {
    if (options.commit) {
      return yield* git(["rev-parse", `${options.commit}^{commit}`]);
    }

    if (options.branch) {
      return yield* git(["rev-parse", `${options.branch}^{commit}`]);
    }

    return undefined;
  });

  const matchesTarget = Effect.gen(function* () {
    const origin = yield* git(["remote", "get-url", "origin"]);
    if (origin !== repoURL) {
      return false;
    }

    if ((yield* git(["status", "--porcelain"])) !== "") {
      return false;
    }

    const target = yield* targetCommit;
    if (target) {
      return (yield* git(["rev-parse", "HEAD"])) === target;
    }

    return true;
  });

  const tryUpdate = Effect.gen(function* () {
    yield* run(["remote", "set-url", "origin", repoURL]);
    yield* run(["fetch", "origin", ...(options.branch ? [options.branch] : [])]);

    if (options.branch) {
      yield* run(["checkout", options.branch]);
      yield* run(["reset", "--hard", `origin/${options.branch}`]).pipe(
        Effect.catch(() => run(["reset", "--hard"])),
      );
    }

    if (options.commit) {
      yield* run(["checkout", options.commit]);
    }

    yield* run(["reset", "--hard"]);
    yield* run(["clean", "-ffdx"]);
  });

  const exists = yield* fs.exists(repoPath);
  if (exists) {
    const matched = yield* matchesTarget.pipe(Effect.catch(() => Effect.succeed(false)));
    if (matched) {
      return;
    }

    const updated = yield* tryUpdate.pipe(
      Effect.flatMap(() => matchesTarget),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (updated) {
      return;
    }

    yield* fs.remove(repoPath, { recursive: true, force: true });
  }

  yield* spawner.success(ChildProcess.make("git", cloneArgs(repoURL, repoPath, options)));

  if (options.commit) {
    yield* run(["checkout", options.commit]);
  }
});

export const withGitRepo = <T extends Task.Task>(repoURL: string, options: Options = {}) =>
  Effect.fn(
    function* (exec: (repoPath: string) => Loader<T> | Promise<Loader<T>>) {
      const fs = yield* FileSystem.FileSystem;

      let repoPath = options.directory;
      if (!repoPath) {
        const tempRepoPath = yield* fs.makeTempDirectory({
          prefix: "open-insight-task-",
        });
        yield* Effect.addFinalizer(() =>
          fs.remove(tempRepoPath, { recursive: true, force: true }).pipe(Effect.ignore),
        );
        repoPath = tempRepoPath;
      }

      yield* loadGitRepo(repoPath, repoURL, options);

      const loader = yield* Effect.tryPromise({
        try: () => Promise.resolve(exec(repoPath)),
        catch: TaskError.load,
      });
      return yield* loader;
    },
    (effect) => effect.pipe(Effect.mapError(TaskError.load), Effect.provide(Spawn.Service.layer)),
  );

export const withGithub = <T extends Task.Task>(id: string, options?: Options) =>
  withGitRepo<T>(`https://github.com/${id}.git`, options);

export const withHuggingface = <T extends Task.Task>(id: string, options?: Options) =>
  withGitRepo<T>(`https://huggingface.co/datasets/${id}.git`, options);
