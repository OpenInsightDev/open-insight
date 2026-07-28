import { Harbor, Tasks } from "@open-insight/eval";
import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as path from "node:path";

layer(NodeServices.layer)((it) => {
  it.effect(
    "loads every Terminal-Bench 2 task through Harbor",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Tasks.withGithub("OpenInsightDev/terminal-bench-2", {
          branch: "main",
          commit: "2fd12b88aafdd04a52c298e3940bcb189f9766d6",
        })(Harbor.fromDir);

        assert.lengthOf(tasks, 89);
        assert.strictEqual(new Set(tasks.map((task) => task.metadata.id)).size, tasks.length);

        for (const task of tasks) {
          assert.match(task.metadata.id, /^terminal-bench\//);
          assert.lengthOf(task.stages, 1);
          assert.strictEqual(task.stages[0]?.metadata.name, "main");
          assert.isNotEmpty(task.stages[0]?.prompt);
          assert.strictEqual(path.basename(task.snapshot.context), "environment");
          assert.strictEqual(
            path.basename(path.dirname(task.snapshot.context)),
            task.metadata.id.slice("terminal-bench/".length),
          );
        }
      }),
    120_000,
  );
});
