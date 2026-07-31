import { assert, it } from "@effect/vitest";
import { Prompt, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import { DateTime, Effect, Schema } from "effect";
import { Response } from "effect/unstable/ai";
import { make } from "./build.ts";
import { mapMetric, mapTaskMetric, metric, taskMetric, trajMetric } from "./metric.ts";

const GradeSchema = Schema.Struct({ simPass: Schema.Boolean });
type Grade = typeof GradeSchema.Type;
type Count = Readonly<{ count: number }>;

const timestamp = DateTime.nowUnsafe();
const usage = Response.Usage.make({ inputTokens: {}, outputTokens: {} });
const trail = (simPass: boolean) => ({
  startedAt: timestamp,
  finishedAt: timestamp,
  usage,
  grade: { simPass },
  trajectory: Prompt.empty,
});

it.effect("attaches direct and mapped metric executors", () =>
  Effect.gen(function* () {
    const benchExec: Metric.Bench.Exec<Grade, Count> = async (results) => ({
      count: Object.values(results).flat().length,
    });
    const mappedBenchExec: Metric.Bench.Exec<Readonly<{ pass: boolean }>, Count> = async (
      results,
    ) => ({
      count: Object.values(results)
        .flat()
        .filter((result) => result.grade.pass).length,
    });
    const taskExec: Metric.Task.Exec<Grade, Count> = async (results) => ({
      count: results.length,
    });
    const mappedTaskExec: Metric.Task.Exec<Readonly<{ pass: boolean }>, Count> = async (
      results,
    ) => ({
      count: results.filter((result) => result.grade.pass).length,
    });
    const trajExec: Metric.Traj.Exec<Count> = async () => ({ count: 1 });

    const task = yield* Task.make({
      id: "bench-metric-task",
      name: "Bench metric task",
      snapshot: Snapshot.make("test-image"),
    }).pipe(
      Task.stage("grade", {
        id: "grade",
        prompt: "Grade the task",
        grader: Grade.make(GradeSchema)(async () => ({ simPass: true })),
      }),
    );

    const bench = yield* make({ id: "bench-metric-exec-inputs", tasks: [task] }).pipe(
      metric(benchExec, { id: "direct-bench" }),
      mapMetric(({ simPass }) => ({ pass: simPass }), mappedBenchExec, {
        id: "mapped-bench",
      }),
      taskMetric("bench-metric-task", taskExec, { id: "direct-task" }),
      mapTaskMetric("bench-metric-task", ({ simPass }) => ({ pass: simPass }), mappedTaskExec, {
        id: "mapped-task",
      }),
      trajMetric("bench-metric-task", trajExec, { id: "traj" }),
    );

    assert.deepStrictEqual(
      bench.metrics.map(({ metadata }) => metadata.id),
      ["direct-bench", "mapped-bench"],
    );
    assert.deepStrictEqual(
      bench.tasks[0]?.metrics.map(({ metadata }) => metadata.id),
      ["direct-task", "mapped-task"],
    );
    assert.deepStrictEqual(
      bench.tasks[0]?.trajMetrics.map(({ metadata }) => metadata.id),
      ["traj"],
    );

    const results = {
      "bench-metric-task": [trail(true), trail(false)],
    };
    const delta = { ...trail(false), task: "bench-metric-task" };
    const mappedBenchMetric = bench.metrics[1];
    const mappedTaskMetric = bench.tasks[0]?.metrics[1];

    if (mappedBenchMetric === undefined || mappedTaskMetric === undefined) {
      return assert.fail("Missing mapped metrics");
    }

    const mappedBenchResult = yield* Effect.promise(() =>
      mappedBenchMetric.exec(results, delta, null),
    );
    const mappedTaskResult = yield* Effect.promise(() =>
      mappedTaskMetric.exec(results["bench-metric-task"], delta, null),
    );
    assert.deepStrictEqual(mappedBenchResult, { count: 1 });
    assert.deepStrictEqual(mappedTaskResult, { count: 1 });
  }),
);
