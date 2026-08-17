import { Context, Effect, Layer, Match } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Spawn from "#/spawn/index.ts";
import { GitError } from "./error.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly commitHash: string;
    readonly remoteOrigin: string;
    readonly isDirty: boolean;
  }
>()("packages/core/git/GitService") {
  static readonly layer: Layer.Layer<Service, GitError, Spawn.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* Spawn.Service;
      const cwd = process.cwd();

      const mapErrorTo = (exitError: GitError) =>
        Effect.mapError((error: Spawn.SpawnError) =>
          Match.value(error.reason).pipe(
            Match.tag("NonZeroExit", () => exitError),
            Match.tag("Platform", () => GitError.checkFailed(error)),
            Match.exhaustive,
          ),
        );
      const mapError = mapErrorTo(GitError.notGitRepo(cwd));

      yield* spawner.success(CP.make`command -v git`).pipe(mapErrorTo(GitError.gitUnavailable));
      yield* spawner.success(CP.make`git status`).pipe(mapError);

      const [commitHash, remoteOrigin, isDirty] = yield* Effect.all(
        [
          spawner.string(CP.make`git rev-parse HEAD`),
          spawner.string(CP.make`git config --get remote.origin.url`),
          spawner
            .string(CP.make`git status --porcelain`)
            .pipe(Effect.map((r) => r.trim().length > 0)),
        ],
        { concurrency: "unbounded" },
      ).pipe(mapError);

      return Service.of({ commitHash, remoteOrigin, isDirty });
    }),
  );
}
