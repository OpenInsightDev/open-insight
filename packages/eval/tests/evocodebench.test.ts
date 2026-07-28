import { Bench, Harbor, Tasks } from "@open-insight/eval";
import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Spawn } from "@open-insight/core/utils";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const datasetId = "evocodebench";
const datasetUrl =
  "https://huggingface.co/datasets/UnipatAI/EvoCodeBench/resolve/main/archives/evocodebench_wotraj.tar.zst";

const findTaskDirs = async (root: string): Promise<ReadonlyArray<string>> => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const taskDirs: Array<string> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(root, entry.name);
    try {
      await fs.access(path.join(directory, "task.toml"));
      taskDirs.push(directory);
    } catch {
      taskDirs.push(...(await findTaskDirs(directory)));
    }
  }

  return taskDirs;
};

export const makeBench = Effect.fn(function* () {
  const tasks = yield* Tasks.withDist({ url: datasetUrl, format: "tar.zst" })(({ distPath }) =>
    Effect.gen(function* () {
      const taskDirs = yield* Effect.tryPromise(() => findTaskDirs(distPath));
      return yield* Effect.all(taskDirs.toSorted().map((taskDir) => Harbor.makeTask(taskDir)));
    }),
  );

  return yield* Bench.make({ id: datasetId, tasks });
});

const testLayer = Layer.mergeAll(
  NodeServices.layer,
  FetchHttpClient.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

layer(testLayer, { excludeTestServices: true })((it) => {
  it.effect(
    "loads every EvoCodeBench task through Harbor",
    () =>
      Effect.gen(function* () {
        const bench = yield* makeBench();

        assert.strictEqual(bench.metadata.id, datasetId);
        assert.lengthOf(bench.tasks, 26);
        assert.strictEqual(
          bench.tasks.reduce((count, task) => count + task.stages.length, 0),
          227,
        );
        assert.strictEqual(new Set(bench.tasks.map((task) => task.metadata.id)).size, 26);

        for (const task of bench.tasks) {
          assert.isAtLeast(task.stages.length, 1);
          assert.strictEqual(path.basename(task.snapshot.context), "environment");
          for (const stage of task.stages) {
            assert.match(stage.metadata.name, /^round-\d+$/);
            assert.isNotEmpty(stage.prompt);
          }
        }
      }),
    300_000,
  );
});
