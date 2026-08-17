import { Context, Effect, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Spawn from "#/spawn/index.ts";
import { GitError } from "./error.ts";

const catchUnavailable = <A, E, R>(eff: Effect.Effect<A, E | Spawn.SpawnError, R>) =>
  eff.pipe(
    Effect.catchTag("SpawnError", (err) =>
      err.reason._tag === "NonZeroExit"
        ? Effect.fail(GitError.gitUnavailable)
        : Effect.fail(GitError.checkFailed(err)),
    ),
  );

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

      yield* catchUnavailable(spawner.success(CP.make`command -v git`));

      yield* catchUnavailable(spawner.success(CP.make`git status`));

      const [commitHash, remoteOrigin, isDirty] = yield* Effect.all(
        [
          spawner.string(CP.make`git rev-parse HEAD`),
          spawner.string(CP.make`git config --get remote.origin.url`),
          spawner
            .string(CP.make`git status --porcelain`)
            .pipe(Effect.map((r) => r.trim().length > 0)),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.catchTag("SpawnError", (err) => Effect.fail(GitError.checkFailed(err))));

      return Service.of({ commitHash, remoteOrigin, isDirty, isInitialized: true });
    }),
  );
}
