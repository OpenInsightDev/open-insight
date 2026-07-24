import type * as Task from "#/task/index.ts";
import { ChildProcess as CP } from "effect/unstable/process";
import { Effect, FileSystem } from "effect";
import { Spawn } from "@open-insight/core/utils";
import type { Load } from "./index.ts";
import { Error } from "./error.ts";

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

const loadGitRepo = Effect.fn(function* (repoPath: string, repoURL: string, options: Options) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* Spawn.Service;

  const targetCommit = Effect.gen(function* () {
    if (options.commit) {
      return yield* spawner
        .string(CP.make`git -C ${repoPath} rev-parse ${`${options.commit}^{commit}`}`)
        .pipe(Effect.map((s) => s.trim()));
    }

    if (options.branch) {
      return yield* spawner
        .string(CP.make`git -C ${repoPath} rev-parse ${`${options.branch}^{commit}`}`)
        .pipe(Effect.map((s) => s.trim()));
    }

    return undefined;
  });

  const matchesTarget = Effect.gen(function* () {
    const origin = yield* spawner
      .string(CP.make`git -C ${repoPath} remote get-url origin`)
      .pipe(Effect.map((s) => s.trim()));
    if (origin !== repoURL) {
      return false;
    }

    if (
      (yield* spawner
        .string(CP.make`git -C ${repoPath} status --porcelain`)
        .pipe(Effect.map((s) => s.trim()))) !== ""
    ) {
      return false;
    }

    const target = yield* targetCommit;
    if (target) {
      return (
        (yield* spawner
          .string(CP.make`git -C ${repoPath} rev-parse HEAD`)
          .pipe(Effect.map((s) => s.trim()))) === target
      );
    }

    return true;
  });

  const tryUpdate = Effect.gen(function* () {
    yield* spawner.success(CP.make`git -C ${repoPath} remote set-url origin ${repoURL}`);
    if (options.branch) {
      yield* spawner.success(CP.make`git -C ${repoPath} fetch origin ${options.branch}`);
    } else {
      yield* spawner.success(CP.make`git -C ${repoPath} fetch origin`);
    }

    if (options.branch) {
      yield* spawner.success(CP.make`git -C ${repoPath} checkout ${options.branch}`);
      yield* spawner
        .success(CP.make`git -C ${repoPath} reset --hard ${`origin/${options.branch}`}`)
        .pipe(Effect.catch(() => spawner.success(CP.make`git -C ${repoPath} reset --hard`)));
    }

    if (options.commit) {
      yield* spawner.success(CP.make`git -C ${repoPath} checkout ${options.commit}`);
    }

    yield* spawner.success(CP.make`git -C ${repoPath} reset --hard`);
    yield* spawner.success(CP.make`git -C ${repoPath} clean -ffdx`);
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

  const depth =
    options.depth === undefined || Number.isFinite(options.depth)
      ? (options.depth ?? 1)
      : undefined;
  if (depth !== undefined && options.branch) {
    yield* spawner.success(
      CP.make`git clone --depth ${depth} --branch ${options.branch} --single-branch ${repoURL} ${repoPath}`,
    );
  } else if (depth !== undefined) {
    yield* spawner.success(CP.make`git clone --depth ${depth} ${repoURL} ${repoPath}`);
  } else if (options.branch) {
    yield* spawner.success(
      CP.make`git clone --branch ${options.branch} --single-branch ${repoURL} ${repoPath}`,
    );
  } else {
    yield* spawner.success(CP.make`git clone ${repoURL} ${repoPath}`);
  }

  if (options.commit) {
    yield* spawner.success(CP.make`git -C ${repoPath} checkout ${options.commit}`);
  }
});

export const withGitRepo = <T extends Task.Task>(repoURL: string, options: Options = {}) =>
  Effect.fn(
    function* (exec: (repoPath: string) => Load<T> | Promise<Load<T>>) {
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

      yield* loadGitRepo(repoPath, repoURL, options).pipe(Effect.mapError(Error.source));

      const loader = yield* Effect.tryPromise({
        try: () => Promise.resolve(exec(repoPath)),
        catch: Error.init,
      });
      return yield* loader;
    },
    (effect) => effect.pipe(Effect.mapError(Error.source), Effect.provide(Spawn.Service.layer)),
  );

export const withGithub = <T extends Task.Task>(id: string, options?: Options) =>
  withGitRepo<T>(`https://github.com/${id}.git`, options);

export const withHuggingface = <T extends Task.Task>(id: string, options?: Options) =>
  withGitRepo<T>(`https://huggingface.co/datasets/${id}.git`, options);
