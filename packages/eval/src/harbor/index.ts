import { Effect, FileSystem, Path, Schema } from "effect";
import * as Task from "#/task/index.ts";
import { Error as TasksError } from "#/tasks/error.ts";
import { readConfig } from "./config.ts";
import { author, makeResources, makeSnapshot, validateConfig } from "./mapping.ts";
import { addStages, makeStages } from "./stages.ts";
import { GradeResult } from "./reward.ts";

export * from "./config.ts";
export * from "./result.ts";
export { GradeResult } from "./reward.ts";
export { makeGrader, makeVerifier } from "./runtime.ts";
export { makeSnapshot } from "./mapping.ts";
export type { HarborTask } from "./types.ts";

export const makeTask = Effect.fn("Task.Load.makeHarborTask")(function* (taskDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(taskDir);
  const composeDir = path.join(root, "environment");
  const hasCompose = yield* Effect.all(
    ["docker-compose.yaml", "docker-compose.yml"].map((file) =>
      fs.exists(path.join(composeDir, file)),
    ),
  ).pipe(
    Effect.map((found) => found.some(Boolean)),
    Effect.mapError(TasksError.source),
  );
  if (hasCompose) {
    return yield* Effect.fail(
      TasksError.unsupported(new Error("Harbor docker-compose environments are not supported")),
    );
  }

  const config = yield* readConfig(root);
  yield* validateConfig(config);

  const snapshot = yield* makeSnapshot(root, config);
  const stages = yield* makeStages(root, config);
  const pkg = config.task;
  const name = pkg?.name ?? path.basename(root);
  const template = Task.Template.make({
    extras: Schema.Record(Schema.String, Schema.Json),
    grade: GradeResult,
  });

  return yield* Task.make(template, {
    id: name,
    name,
    description: pkg?.description,
    keywords: pkg?.keywords,
    authors: pkg?.authors?.map(author),
    snapshot,
    resources: makeResources(config),
    extras: config.metadata ?? {},
  }).pipe(addStages(stages), Task.build, Effect.mapError(TasksError.init));
});
