import { assert, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core/internal";
import { Crypto, Effect, Layer } from "effect";
import * as Task from "#/task/index.ts";
import type { Bench } from "./build.ts";
import { taskMetric, trajMetric } from "./metric.ts";

const TestCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const makeBench = Effect.gen(function* () {
  const first = yield* Task.make({
    id: "first",
    name: "Shared name",
    snapshot: Snapshot.make({ image: "scratch" }),
  });
  const second = yield* Task.make({
    id: "second",
    name: "Shared name",
    snapshot: Snapshot.make({ image: "scratch" }),
  });

  return {
    subset: false,
    tasks: [first, second],
    metrics: [],
  } satisfies Bench;
});

it.layer(TestCrypto)((it) => {
  it.effect("adds metrics to the task selected by id", () =>
    Effect.gen(function* () {
      const base = yield* makeBench;
      const bench = yield* Effect.succeed(base).pipe(
        taskMetric("second", {
          id: "score",
          exec: async () => ({ score: 1 }),
        }),
        trajMetric("second", {
          id: "tokens",
          exec: async () => ({ tokens: 10 }),
        }),
      );

      assert.deepStrictEqual(base.tasks[1]?.metrics, []);
      assert.deepStrictEqual(base.tasks[1]?.trajMetrics, []);
      assert.deepStrictEqual(bench.tasks[0]?.metrics, []);
      assert.deepStrictEqual(
        bench.tasks[1]?.metrics.map(({ id }) => id),
        ["score"],
      );
      assert.deepStrictEqual(
        bench.tasks[1]?.trajMetrics.map(({ id }) => id),
        ["tokens"],
      );
    }),
  );

  it.effect("fails when the task id does not exist", () =>
    Effect.gen(function* () {
      const error = yield* makeBench.pipe(
        taskMetric("missing", {
          id: "score",
          exec: async () => ({ score: 1 }),
        }),
        Effect.flip,
      );

      assert.strictEqual(error.reason._tag, "TaskNotFound");
      if (error.reason._tag === "TaskNotFound") {
        assert.strictEqual(error.reason.id, "missing");
      }
    }),
  );
});
