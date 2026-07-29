import { assert, it } from "@effect/vitest";
import { NodeCrypto } from "@effect/platform-node";
import { Snapshot } from "@open-insight/core/internal";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import { Effect, Schema } from "effect";
import { make } from "./build.ts";
import { metric, taskMetric, trajMetric } from "./metric.ts";

class GradeResult extends Schema.Class<GradeResult>("BenchMetricGradeResult")({
  pass: Schema.Boolean,
}) {}

const template = Task.Template.make({
  grade: GradeResult,
});

it.effect("accepts raw and Effect metric executors", () =>
  Effect.gen(function* () {
    const exec: Metric.Bench.Exec<
      Readonly<{ pass: boolean }>,
      Readonly<{ count: number }>
    > = async () => ({ count: 1 });
    const taskExec: Metric.Task.Exec<GradeResult, Readonly<{ count: number }>> = async () => ({
      count: 1,
    });
    const trajExec: Metric.Traj.Exec<Readonly<{ count: number }>> = async () => ({ count: 1 });
    const task = yield* Task.make(template, {
      id: "bench-metric-task",
      name: "Bench metric task",
      snapshot: Snapshot.make("test-image"),
    }).pipe(
      Task.stage("grade", {
        schema: GradeResult,
        prompt: "Grade the task",
        grader: async () => ({ pass: true }),
      }),
      Task.build,
    );

    const bench = yield* make({ id: "bench-metric-exec-inputs", tasks: [task] }).pipe(
      metric(exec, { id: "raw-bench" }),
      metric(Metric.Bench.exec(exec), { id: "effect-bench" }),
      taskMetric("bench-metric-task", taskExec, { id: "raw-task" }),
      taskMetric("bench-metric-task", Metric.Task.exec(taskExec), { id: "effect-task" }),
      taskMetric("bench-metric-task", { id: "options-task", exec: taskExec }),
      trajMetric("bench-metric-task", trajExec, { id: "raw-traj" }),
      trajMetric("bench-metric-task", { id: "options-traj", exec: trajExec }),
    );

    assert.deepStrictEqual(
      bench.metrics.map(({ metadata }) => metadata.id),
      ["raw-bench", "effect-bench"],
    );
    assert.isTrue(bench.metrics.every((metric) => metric.exec === exec));
    assert.deepStrictEqual(
      bench.tasks[0]?.metrics.map(({ metadata }) => metadata.id),
      ["raw-task", "effect-task", "options-task"],
    );
    assert.isTrue(bench.tasks[0]?.metrics.every((metric) => metric.exec === taskExec));
    assert.deepStrictEqual(
      bench.tasks[0]?.trajMetrics.map(({ metadata }) => metadata.id),
      ["raw-traj", "options-traj"],
    );
    assert.isTrue(bench.tasks[0]?.trajMetrics.every((metric) => metric.exec === trajExec));
  }).pipe(Effect.provide(NodeCrypto.layer)),
);
