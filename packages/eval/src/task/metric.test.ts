import { NodeCrypto } from "@effect/platform-node";
import { Snapshot } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Metric from "#/metric/index.ts";
import { make } from "./build.ts";
import { metric, trajMetric } from "./metric.ts";

it.effect("accepts raw and Effect metric executors", () =>
  Effect.gen(function* () {
    const taskExec: Metric.Task.Exec<
      Readonly<{ pass: boolean }>,
      Readonly<{ count: number }>
    > = async () => ({ count: 1 });
    const trajExec: Metric.Traj.Exec<Readonly<{ count: number }>> = async () => ({ count: 1 });

    const task = yield* make({
      id: "metric-exec-inputs",
      name: "Metric exec inputs",
      snapshot: Snapshot.make({ image: "test-image" }),
    }).pipe(
      metric(taskExec, { id: "raw-task" }),
      metric(Metric.Task.exec(taskExec), { id: "effect-task" }),
      trajMetric(trajExec, { id: "raw-traj" }),
    );

    assert.deepStrictEqual(
      task.metrics.map(({ metadata }) => metadata.id),
      ["raw-task", "effect-task"],
    );
    assert.isTrue(task.metrics.every(({ exec }) => exec === taskExec));
    assert.deepStrictEqual(
      task.trajMetrics.map(({ metadata }) => metadata.id),
      ["raw-traj"],
    );
    assert.isTrue(task.trajMetrics.every(({ exec }) => exec === trajExec));
  }).pipe(Effect.provide(NodeCrypto.layer)),
);
