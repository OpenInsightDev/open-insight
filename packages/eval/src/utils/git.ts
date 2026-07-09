import { Effect } from "effect";
import { Spawn } from "@open-insight/core/utils";
import { ChildProcess as CP } from "effect/unstable/process";

export const commit = Effect.fn(function* () {
  const spawner = yield* Spawn.SpawnService;
  return yield* spawner.string(CP.make`git rev-parse HEAD`);
});

export const remoteOrigin = Effect.fn(function* () {
  const spawner = yield* Spawn.SpawnService;
  return yield* spawner.string(CP.make`git config --get remote.origin.url`);
});

export const dirty = Effect.fn(function* () {
  const spawner = yield* Spawn.SpawnService;
  const result = yield* spawner.string(CP.make`git status --porcelain`);
  return result.trim().length > 0;
});
