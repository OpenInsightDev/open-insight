import { Bench, Harbor, Tasks } from "@open-insight/eval";
import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Path } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

const datasetId = "evocodebench";
const datasetUrl =
  "https://huggingface.co/datasets/UnipatAI/EvoCodeBench/resolve/main/archives/evocodebench_wotraj.tar.zst";

export const makeBench = Effect.fn(function* () {
  const tasks = yield* Tasks.withDist({ url: datasetUrl, format: "tar.zst" })(({ distPath }) =>
    Harbor.fromDir(distPath),
  );
  return yield* Bench.make({ id: datasetId, tasks });
});

const testLayer = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer);

layer(testLayer, { excludeTestServices: true })((it) => {
  it.effect(
    "loads every EvoCodeBench task through Harbor",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
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
