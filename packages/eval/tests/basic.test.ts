import { Snapshot } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import * as Tasks from "#/tasks/index.ts";
import { Effect, Schema } from "effect";

const GradeResult = Schema.Struct({ simPass: Schema.Boolean });

const makeTask = (id: string) =>
  Task.make({
    id,
    name: id,
    snapshot: Snapshot.make("test-image"),
  }).pipe(
    Task.stage("grade", {
      id: "grade",
      prompt: "Grade the task",
      grader: Grade.make(GradeResult)(async () => ({ simPass: true })),
    }),
  );

it.effect("builds a task and attaches metrics", () =>
  Effect.gen(function* () {
    yield* Task.make({
      id: "basic",
      name: "Basic",
      snapshot: Snapshot.make("test-image"),
    }).pipe(
      Task.stage("grade", {
        id: "grade",
        prompt: "Grade the task",
        grader: Grade.make(GradeResult)(async () => ({ simPass: true })),
      }),
      Task.metric(
        async (results, delta, prev) => ({
          count: results.length,
        }),
        { id: "count", name: "Count" },
      ),
      Task.mapMetric(
        (grade) => ({ pass: grade.simPass }),
        async (results, delta, prev) => ({
          passCount: results.filter((r) => r.grade.pass).length,
        }),
        { id: "pass", name: "Pass" },
      ),
      Task.trajMetric(async () => ({ count: 1 }), { id: "traj", name: "Traj" }),
    );
  }),
);

it.effect("builds a bench and attaches metrics", () =>
  Effect.gen(function* () {
    const bench = yield* Bench.make(
      "basic-bench",
      Tasks.fromIter([makeTask("a"), makeTask("b")]),
    ).pipe(
      Bench.metric(
        async (results, delta, prev) => ({
          tasks: Object.keys(results).length,
          trails: Object.values(results).reduce((sum, trails) => sum + trails.length, 0),
          lastTask: delta.task,
        }),
        { id: "progress", name: "Progress" },
      ),
      Bench.mapMetric(
        (grade) => ({ pass: grade.simPass }),
        async (results, delta, prev) => ({
          passingTasks: Object.values(results).filter((trails) =>
            trails.some((trail) => trail.grade.pass),
          ).length,
        }),
        { id: "passing-tasks", name: "Passing tasks" },
      ),
      Bench.taskMetric("a", async (results, delta, prev) => ({ attempts: results.length }), {
        id: "a-attempts",
        name: "Task A attempts",
      }),
      Bench.mapTaskMetric(
        "b",
        (grade) => ({ pass: grade.simPass }),
        async (results, delta, prev) => ({
          passes: results.filter((trail) => trail.grade.pass).length,
        }),
        { id: "b-passes", name: "Task B passes" },
      ),
      Bench.trajMetric("a", async () => ({ count: 1 }), {
        id: "a-trajectory",
        name: "Task A trajectory",
      }),
    );

    assert.equal(bench.metadata.id, "basic-bench");
    assert.deepStrictEqual(
      bench.tasks.map((task) => task.metadata.id),
      ["a", "b"],
    );
    assert.deepStrictEqual(
      bench.metrics.map((metric) => metric.metadata.id),
      ["progress", "passing-tasks"],
    );
    assert.deepStrictEqual(
      bench.tasks[0].metrics.map((metric) => metric.metadata.id),
      ["a-attempts"],
    );
    assert.deepStrictEqual(
      bench.tasks[1].metrics.map((metric) => metric.metadata.id),
      ["b-passes"],
    );
    assert.deepStrictEqual(
      bench.tasks[0].trajMetrics.map((metric) => metric.metadata.id),
      ["a-trajectory"],
    );
  }),
);

it.effect("fails when attaching a task metric to an unknown task", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      Bench.make("basic-bench", Tasks.fromIter([makeTask("a")])).pipe(
        Bench.taskMetric("missing", async () => ({ count: 0 }), {
          id: "count",
          name: "Count",
        }),
      ),
    );

    assert.equal(failure.reason._tag, "TaskNotFound");
    assert.equal(failure.message, 'Benchmark task "missing" was not found');
  }),
);
