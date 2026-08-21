import type * as Task from "#/task/index.ts";
import { ChildProcess as CP } from "effect/unstable/process";
import { Crypto, Effect, Encoding, FileSystem, Path } from "effect";
import { Spawn } from "@open-insight/core";
import * as Cache from "../cache.ts";
import type { Load } from "../index.ts";
import { TasksError } from "../error.ts";

interface Options {
  /** Target directory. Defaults to a cache directory under `.open-insight/git/`. */
  readonly directory?: string;
  /** Branch or tag name to checkout. */
  readonly branch?: string;
  /** Specific commit hash to checkout after cloning. */
  readonly commit?: string;
  /** Clone depth. Defaults to 1. Use `Infinity` for a full clone. */
  readonly depth?: number;
  /** Only fetch the specified branch. Defaults to `true` when `branch` is set. */
  readonly singleBranch?: boolean;
  /** Shell script to run from the repository root after the repository is prepared. */
  readonly postInit?: string;
  /** Remove the auto-created repo cache directory after the tasks are loaded. Ignored when `directory` is set. Defaults to `false`. */
  readonly cleanup?: boolean;
}

const loadGitRepo = Effect.fn(function* (repoPath: string, repoURL: string, options: Options) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* Spawn.Service;
  const managed = options.directory === undefined;

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

    return null;
  });

  const checkoutCommit = Effect.fn("loadGitRepo.checkoutCommit")(function* (commit: string) {
    const checkedOut = yield* spawner.success(CP.make`git -C ${repoPath} checkout ${commit}`).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (checkedOut) {
      return;
    }

    yield* spawner.success(CP.make`git -C ${repoPath} fetch --depth 1 origin ${commit}`);
    yield* spawner.success(CP.make`git -C ${repoPath} checkout ${commit}`);
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
      yield* checkoutCommit(options.commit);
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

    if (!managed) {
      const entries = yield* fs.readDirectory(repoPath);
      if (entries.length > 0) {
        return yield* TasksError.directoryConflict(repoPath);
      }
    }

    if (managed) {
      const updated = yield* tryUpdate.pipe(
        Effect.flatMap(() => matchesTarget),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (updated) {
        return;
      }

      yield* fs.remove(repoPath, { recursive: true, force: true });
    }
  }

  const depth =
    options.depth === undefined || Number.isFinite(options.depth)
      ? (options.depth ?? 1)
      : undefined;
  const cloneArgs = ["clone"];
  if (depth !== undefined) {
    cloneArgs.push("--depth", String(depth));
  }
  if (options.branch) {
    cloneArgs.push("--branch", options.branch);
  }
  if (options.singleBranch ?? options.branch !== undefined) {
    cloneArgs.push("--single-branch");
  }
  cloneArgs.push(repoURL, repoPath);
  yield* spawner.success(CP.make("git", cloneArgs));

  if (options.commit) {
    yield* checkoutCommit(options.commit);
  }
});

export const withGitRepo = (repoURL: string, options: Options = {}) =>
  Effect.fn(
    function* <T extends Task.AnyTask, E, R>(
      exec: (repoPath: string) => Load<T, E, R> | Promise<Load<T, E, R>>,
    ) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const cached = options.directory === undefined;
      let repoPath = options.directory;
      if (!repoPath) {
        const crypto = yield* Crypto.Crypto;
        const key = Encoding.encodeHex(
          yield* crypto.digest("SHA-256", new TextEncoder().encode(repoURL)),
        ).slice(0, 16);
        repoPath = yield* Cache.cacheDir(path.join("git", key));
      }
      if (options.cleanup && cached) {
        yield* Effect.addFinalizer(() =>
          fs.remove(repoPath, { recursive: true, force: true }).pipe(Effect.ignore),
        );
      }

      yield* loadGitRepo(repoPath, repoURL, options).pipe(
        Effect.mapError((cause) =>
          cause instanceof TasksError ? cause : TasksError.source(cause),
        ),
      );
      if (options.postInit !== undefined) {
        const spawner = yield* Spawn.Service;
        yield* spawner
          .success(CP.make({ cwd: repoPath })`sh -c ${options.postInit}`)
          .pipe(Effect.mapError(TasksError.source));
      }

      const loader = yield* Effect.tryPromise({
        try: () => Promise.resolve(exec(repoPath)),
        catch: TasksError.init,
      });
      return yield* loader;
    },
    (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
  );

export const withGithub = (id: string, options?: Options) =>
  withGitRepo(`https://github.com/${id}.git`, options);

export const withHuggingface = (id: string, options?: Options) =>
  withGitRepo(`https://huggingface.co/datasets/${id}.git`, options);
