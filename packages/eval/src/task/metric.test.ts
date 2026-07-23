import { assert, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core/internal";
import { Crypto, Effect, Layer } from "effect";
import { make, metric, trajMetric } from "./build.ts";

const snapshot = Snapshot.make({ image: "scratch" });
const TestCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

it.layer(TestCrypto)((it) => {
  it.effect("adds task and trajectory metrics", () =>
    Effect.gen(function* () {
      const task = yield* make({ id: "task", name: "task", snapshot }).pipe(
        metric("task-metric", {
          exec: async () => ({ score: 1 }),
        }),
        trajMetric("traj-metric", {
          exec: async () => ({ tokens: 10 }),
        }),
      );

      assert.lengthOf(task.metrics, 1);
      assert.strictEqual(task.metrics[0]?.id, "task-metric");
      assert.lengthOf(task.trajMetrics, 1);
      assert.strictEqual(task.trajMetrics[0]?.id, "traj-metric");
    }),
  );

  it.effect("starts with empty metric arrays and appends metrics", () =>
    Effect.gen(function* () {
      const base = yield* make({ id: "task", name: "task", snapshot });
      assert.deepStrictEqual(base.metrics, []);
      assert.deepStrictEqual(base.trajMetrics, []);

      const task = yield* Effect.succeed(base).pipe(
        metric("first", { exec: async () => ({ value: 1 }) }),
        metric("second", { exec: async () => ({ value: 2 }) }),
      );

      assert.deepStrictEqual(
        task.metrics.map(({ id }) => id),
        ["first", "second"],
      );
    }),
  );

  it.effect("builds metrics directly from task options", () =>
    Effect.gen(function* () {
      const task = yield* make({
        id: "task",
        name: "task",
        snapshot,
        metrics: [
          { id: "first", exec: async () => ({ value: 1 }) },
          { id: "second", exec: async () => ({ value: 2 }) },
        ],
        trajMetrics: [{ id: "trajectory", exec: async () => ({ tokens: 10 }) }],
      });

      assert.deepStrictEqual(
        task.metrics.map(({ id }) => id),
        ["first", "second"],
      );
      assert.strictEqual(task.trajMetrics[0]?.id, "trajectory");
    }),
  );
});
