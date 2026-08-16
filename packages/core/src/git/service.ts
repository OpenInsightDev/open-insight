import { Context, Effect, Layer, Match } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Spawn from "#/utils/spawn.ts";
import { GitError } from "./error.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly commitHash: string;
    readonly remoteOrigin: string;
    readonly isDirty: boolean;
    readonly isInitialized: boolean;
  }
>()("packages/core/git/GitService") {
  static readonly layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* Spawn.Service;
      const cwd = process.cwd();

      const mapSpawnError =
        (exitError: GitError = GitError.notGitRepo(cwd)) =>
        (error: Spawn.Error) =>
          Match.value(error.cause).pipe(
            Match.tag("SpawnExitCodeError", () => exitError),
            Match.orElse(() => GitError.checkFailed(error)),
          );

      yield* spawner
        .success(CP.make`command -v git`)
        .pipe(Effect.mapError(mapSpawnError(GitError.gitUnavailable())));

      yield* spawner.success(CP.make`git status`).pipe(Effect.mapError(mapSpawnError()));

      const [commitHash, remoteOrigin, isDirty] = yield* Effect.all(
        [
          spawner.string(CP.make`git rev-parse HEAD`),
          spawner.string(CP.make`git config --get remote.origin.url`),
          spawner
            .string(CP.make`git status --porcelain`)
            .pipe(Effect.map((r) => r.trim().length > 0)),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.mapError(mapSpawnError()));

      return Service.of({ commitHash, remoteOrigin, isDirty, isInitialized: true });
    }),
  );
}
