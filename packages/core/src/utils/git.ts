import { Effect, Formatter, Schema } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Spawn from "./spawn.ts";

export const commitHash = Effect.fn(
  function* (): Effect.fn.Return<string, Spawn.Error, Spawn.Service> {
    const spawner = yield* Spawn.Service;
    return yield* spawner.string(CP.make`git rev-parse HEAD`);
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);

export const remoteOrigin = Effect.fn(
  function* (): Effect.fn.Return<string, Spawn.Error, Spawn.Service> {
    const spawner = yield* Spawn.Service;
    return yield* spawner.string(CP.make`git config --get remote.origin.url`);
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);

export const isDirty = Effect.fn(
  function* (): Effect.fn.Return<boolean, Spawn.Error, Spawn.Service> {
    const spawner = yield* Spawn.Service;
    const result = yield* spawner.string(CP.make`git status --porcelain`);
    return result.trim().length > 0;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);

export const isInitialized = Effect.fn(
  function* (): Effect.fn.Return<boolean, Spawn.Error, Spawn.Service> {
    const spawner = yield* Spawn.Service;
    const code = yield* spawner.exitCode(CP.make`git status`);
    return code === 0;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);

/** The git failure that occurred. */
export const GitKind = Schema.Literals(["not-a-repo", "dirty-working-tree", "check-failed"]);
export type GitKind = Schema.Schema.Type<typeof GitKind>;

/** A unified git error for failures during a git operation. */
export class GitError extends Schema.TaggedError<GitError>("open-insight/GitError")("GitError", {
  kind: Schema.Literals(["not-a-repo", "dirty-working-tree", "check-failed"]),
  cwd: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.kind) {
      case "not-a-repo":
        return `Run directory "${this.cwd}" is not a git repository`;
      case "dirty-working-tree":
        return `Git working tree at "${this.cwd}" is dirty; commit or stash changes before running the operation`;
      case "check-failed":
        return `Git check failed at "${this.cwd}": ${Formatter.format(this.cause)}`;
    }
  }

  static notGitRepo = (cwd: string): GitError => GitError.make({ kind: "not-a-repo", cwd });

  static dirtyWorkingTree = (cwd: string): GitError =>
    GitError.make({ kind: "dirty-working-tree", cwd });

  static checkFailed =
    (cwd: string) =>
    (cause: unknown): GitError =>
      GitError.make({ kind: "check-failed", cwd, cause });
}

/**
 * Aborts when the current directory is not a git repository or the working
 * tree is dirty. Node services are provided via `Effect.fn`'s second argument
 * so the guard needs no external environment.
 */
export const checkClean = Effect.fn(function* () {
  const cwd = process.cwd();
  const initialized = yield* isInitialized().pipe(Effect.mapError(GitError.checkFailed(cwd)));
  if (!initialized) {
    return yield* Effect.fail(GitError.notGitRepo(cwd));
  }
  const dirty = yield* isDirty().pipe(Effect.mapError(GitError.checkFailed(cwd)));
  if (dirty) {
    return yield* Effect.fail(GitError.dirtyWorkingTree(cwd));
  }
});
