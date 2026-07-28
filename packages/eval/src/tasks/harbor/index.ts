import { Crypto, Effect, FileSystem, Path, Scope } from "effect";
import * as Task from "#/task/index.ts";
import { Error as TasksError } from "../error.ts";
import { readConfig } from "./config.ts";
import { author, makeResources, makeSnapshot, validateConfig } from "./mapping.ts";
import { addStages, makeStages } from "./stages.ts";
import type { HarborTask } from "./types.ts";

export * from "./config.ts";
export { GradeResult } from "./reward.ts";
export { makeGrader, makeVerifier } from "./runtime.ts";
export { makeSnapshot } from "./mapping.ts";
export type { HarborTask } from "./types.ts";

type TaskEffect = Effect.Effect<HarborTask, TasksError, Crypto.Crypto | Scope.Scope>;

export const makeTask = Effect.fn("Task.Load.makeHarborTask")(function* (taskDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(taskDir);
  const config = yield* readConfig(root);
  const hasCompose = yield* fs
    .exists(path.join(root, "environment", "docker-compose.yaml"))
    .pipe(Effect.mapError(TasksError.source));
  yield* validateConfig(config, hasCompose);

  const snapshot = yield* makeSnapshot(root, config);
  const stages = yield* makeStages(root, config);
  const pkg = config.task;
  const name = pkg?.name ?? path.basename(root);
  const base: TaskEffect = Task.make({
    id: name,
    name,
    description: pkg?.description,
    keywords: pkg?.keywords,
    authors: pkg?.authors?.map(author),
    snapshot,
    resources: makeResources(config),
    extras: config.metadata ?? {},
  }).pipe(Effect.mapError(TasksError.init));

  return yield* addStages(base, stages);
});
