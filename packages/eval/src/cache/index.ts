import { Cache, Git } from "@open-insight/core/internal";
import { Effect, Path } from "effect";

const NAMESPACE = "eval" as const;

export const ensureDir = Effect.fn(function* (evalID: string) {
  const git = yield* Git.Service;
  const path = yield* Path.Path;

  const commit = yield* git.commitHash;

  return yield* Cache.ensureDir({ subdir: path.join(NAMESPACE, commit, evalID) });
}, Effect.provide(Git.Service.layer));
