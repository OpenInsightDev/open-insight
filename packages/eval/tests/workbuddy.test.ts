import { Bench, Tasks } from "@open-insight/eval";
import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Spawn } from "@open-insight/core/utils";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const datasetId = "wb-bench-office-v1.0";
const datasetUrl = `https://huggingface.co/datasets/tencent/workbuddy-bench/resolve/main/${datasetId}.tar.gz`;

export const makeBench = Effect.fn(function* () {
  const tasks = yield* Tasks.withDist({ url: datasetUrl })(({ distPath }) =>
    Effect.gen(function* () {
      const tasksDir = path.resolve(distPath, datasetId, "tasks");
      const entries = yield* Effect.tryPromise(() => fs.readdir(tasksDir, { withFileTypes: true }));

      return yield* Effect.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => Tasks.Harbor.makeTask(path.resolve(tasksDir, entry.name))),
      );
    }),
  );

  return yield* Bench.make({
    id: datasetId,
    tasks,
  });
});

const testLayer = Layer.mergeAll(
  NodeServices.layer,
  FetchHttpClient.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

layer(testLayer, { excludeTestServices: true })((it) => {
  it.effect(
    "loads the WorkBuddy Office distribution and creates its Harbor tasks",
    () =>
      Effect.gen(function* () {
        const bench = yield* makeBench();

        assert.strictEqual(bench.metadata.id, datasetId);
        assert.lengthOf(bench.tasks, 50);

        for (const task of bench.tasks) {
          assert.lengthOf(task.stages, 1);
          assert.strictEqual(task.stages[0]?.metadata.name, "main");
          assert.match(task.snapshot.context, /wb-bench-office-v1\.0\/tasks\//);
        }
      }),
    300_000,
  );
});
