# Create a Benchmark

A benchmark (`Bench.Bench`) is the immutable evaluation unit passed to `Eval.run`. It contains:

- benchmark metadata (`id`, optional `subset`, and optional JSON `extras`);
- an ordered, materialized array of built `Task.Task` values;
- metrics that aggregate completed trails across tasks.

This document covers assembling and shaping the benchmark. Define the tasks first with [Create a task](create-task.md), define their sandbox environment with [Define a snapshot](create-snapshot.md), and define benchmark-wide computations with [Create a bench metric](create-bench-metric.md). Task-local metrics belong in [Create a task metric](create-task-metric.md); trajectory metrics belong in [Create a task-specific trajectory metric](create-traj-metric.md).

## Decide the Benchmark Contract

Before writing the loader, establish:

- the stable benchmark ID;
- the authoritative task source and its pinned revision, archive, or commit;
- the task ID rule and whether IDs are unique after filtering;
- the task grade contract and which grade fields benchmark metrics will consume;
- the full dataset and the reproducible evaluation subsets;
- the number of trails required by each metric.

Do not change a task's domain grade merely to satisfy `BenchMetric.avgPassAtK` or `BenchMetric.avgPassPowK`. Those built-ins expect `{ pass: boolean }`; adapt a confirmed grade at the metric boundary with `BenchMetric.mapGrade(...)`. See [Define grading](create-task-grade.md) when the meaning of a grade is not established yet.

Keep benchmark-wide aggregation separate from task construction:

| Scope | Input | Attach with |
| --- | --- | --- |
| Trajectory | Events from one agent trail | `Task.trajMetric(...)` |
| Task | Completed trails for one task | `Task.metric(...)` |
| Benchmark | Completed trails grouped across tasks | `Bench.metric(...)` |

## Build the Task Collection

`Bench.make` accepts a `Tasks.Load<T, E, R>`, an Effect that produces the ordered collection of already built tasks. The loader may fetch or unpack data, and its errors and service requirements remain part of the benchmark construction Effect.

For a small static collection:

```ts
import { Bench, Effect } from "@open-insight/eval";

const bench = Effect.gen(function*() {
  return yield* Bench.make({
    id: "example-bench",
    tasks: Effect.all([
      makeTask("task-a"),
      makeTask("task-b"),
    ]),
  });
});
```

For a dataset discovered asynchronously, yield one task effect per source record and materialize the collection with `Tasks.fromAsyncIter`:

```ts
import { Bench, Effect, Tasks } from "@open-insight/eval";

async function* loadTaskEffects(records: AsyncIterable<SourceRecord>) {
  for await (const record of records) {
    yield makeTask(record); // Effect that builds one Task
  }
}

export const makeBench = Effect.fn(function* () {
  return yield* Bench.make({
    id: "example-bench",
    tasks: Tasks.fromAsyncIter(loadTaskEffects(sourceRecords())),
  });
});
```

`Tasks.fromIter`, `Tasks.fromAsyncIter`, and `Tasks.fromStream` resolve task effects and preserve their order. Pass the resulting loader Effect directly to `Bench.make`. Use the source-specific loaders when appropriate: for example, `Harbor.fromDir` can load Harbor tasks, while `Tasks.withGithub` and `Tasks.withDist` can acquire a pinned source before passing its path to a loader. Inspect the current `Tasks` exports before choosing a loader; the available integrations can grow over time.

Every task must be built before it enters the benchmark. The usual task pipeline is:

1. `Task.make(options)`;
2. `Task.stage(name, ...)` for each stage in execution order, the last one being the final stage;
3. `Task.metric(...)` and `Task.trajMetric(...)` on the completed task.

See [Create a task](create-task.md) for the grade schema, stages, grader, verification mode, and task-local metrics. A benchmark loader should not silently catch a task construction failure and turn it into a missing task: an invalid dataset or task definition is a benchmark initialization failure.

## Initialize the Benchmark

The minimal constructor is an Effect:

```ts
import { Bench, Effect, Tasks } from "@open-insight/eval";

const bench = Effect.gen(function*() {
  return yield* Bench.make({
    id: "example-bench",
    tasks: Tasks.fromDir({ dir: "./tasks" }),
  });
});
```

The options are:

- `id: string`: stable identifier used in evaluation results, events, logs, and metric scope;
- `tasks: Tasks.Load`: an Effect that produces the complete ordered task collection for this benchmark value;
- `subset?: boolean`: defaults to `false`; indicates that the benchmark is a selected subset;
- `extras?: Record<string, Json>`: optional benchmark-level data;
- `metrics?: ReadonlyArray<BenchMetric.Metric>`: optional metrics already constructed, normally supplied through the `Bench.metric(...)` builder described below.

`Bench.make` decodes the base metadata, runs the task loader, and returns an Effect whose error and environment include the loader's error and service requirements. Run it inside an `Effect.gen` or compose it with `pipe`; do not treat it as a plain object. The constructor does not deduplicate IDs or sort tasks, so validate those invariants in the loader when they matter.

The benchmark metadata has a deliberately small base shape. `Bench.metadata(bench)` creates the serializable metadata object containing the benchmark base metadata and each task's metadata. This is the metadata emitted with evaluation initialization events; it is not a replacement for the runtime task definitions.

## Attach Benchmark Metrics

Attach a benchmark-wide metric after `Bench.make` and before `Eval.run`:

```ts
import { Bench, BenchMetric, Chart } from "@open-insight/eval";

const bench = yield* Bench.make({
  id: "example-bench",
  tasks,
}).pipe(
  Bench.metric(
    BenchMetric.avgPassAtK(1).pipe(
      BenchMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
    ),
    {
      id: "average-pass-at-1",
      name: "Average pass@1",
      description: "Mean task-level pass@1 estimate across the benchmark.",
      chart: (result) => [
        Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
        Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
      ],
    },
  ),
);
```

`Bench.metric(exec, options)` accepts either a raw async executor or an `Effect` that produces the executor. It constructs the metric, maps construction failures to `BenchError`, and appends the metric to `bench.metrics`. The metric runs whenever a new task trail result is available. Its executor receives:

- `results`: all completed trails grouped by task ID;
- `delta`: the newly completed trail plus its task ID;
- `prev`: the metric's previous JSON result, or `null` for its first execution.

The trails expose the task grader's decoded grade. For a `Schema.Class` grader, metric code accesses instance fields directly from `trail.grade`.

Use `BenchMetric.exec(...)` for a custom computation, or use a built-in and adapt the grade when needed. Read [Create a bench metric](create-bench-metric.md) for executor semantics, incremental state, built-ins, and metric-specific checklists.

The metric options use the same metadata conventions as other metrics: keep `id` stable, make `name` and `description` explain the result, and add `chart` only for a meaningful synchronous visualization. A benchmark metric cannot be attached to an individual task; use `Task.metric` for that scope.

## Select a Reproducible Subset

Selection functions are Effect combinators. Start with the full benchmark and apply one when a run needs fewer tasks:

```ts
const smokeBench = makeBench().pipe(Bench.head(10));
const afterWarmup = makeBench().pipe(Bench.skip(10));
const tailBench = makeBench().pipe(Bench.tail(10));
const middleBench = makeBench().pipe(Bench.slice(5, 15));
const configuredBench = makeBench().pipe(Bench.select(["task-a", "task-c"]));
const keywordBench = makeBench().pipe(Bench.selectWhere((task) => task.metadata.id.startsWith("math-")));
const sampledBench = makeBench().pipe(Bench.randomSelect(10));
const ratioBench = makeBench().pipe(Bench.sample("20%"));
```

- `Bench.head(n)`: keeps the first `n` tasks in source order;
- `Bench.skip(n)`: removes the first `n` tasks;
- `Bench.tail(n)`: keeps the last `n` tasks in source order;
- `Bench.slice(start, end?)`: keeps the tasks in the half-open range `[start, end)`, following `Array.slice` semantics including negative indexes;
- `Bench.select(ids)`: keeps tasks whose `metadata.id` is in `ids`, in source order;
- `Bench.selectWhere(predicate)`: keeps tasks for which the predicate on the task value (commonly its metadata) returns `true`, in source order;
- `Bench.randomSelect(n)`: shuffles the task array using Effect's random service and keeps `n`;
- `Bench.sample(percentage)`: shuffles the task array and keeps `Math.floor(total * ratio)` tasks, where `percentage` is a string such as `"20%"` and `ratio` is the parsed value divided by 100.

All nine operations return a benchmark with `metadata.subset === true`. They preserve benchmark metadata, metrics, and task values while replacing the task array. `randomSelect` and `sample` are intentionally not stable sampling policies by themselves; use a controlled random service or an explicit ID list when the selected set must be reproducible across runs.

Apply selection to the benchmark Effect, not to the raw task array, so the subset marker and all attached metrics remain part of the resulting benchmark. For configured IDs, validate that every requested ID exists if silently ignoring unknown IDs would hide a configuration error; the built-in `Bench.select` and `Bench.selectWhere` simply filter, while `Bench.taskMetric` and `Bench.trajMetric` fail with `BenchError` when their task ID does not exist.

## Complete Assembly Pattern

Keep the loader, benchmark construction, optional metrics, and optional selection as separate stages. This makes the full dataset reusable by smoke tests and production evaluation:

```ts
import { Bench, BenchMetric, Chart, Effect, Tasks } from "@open-insight/eval";

export const makeFullBench = Effect.fn(function* () {
  return yield* Bench.make({
    id: "example-bench",
    tasks: Tasks.fromAsyncIter(loadTaskEffects()),
  }).pipe(
    Bench.metric(
      BenchMetric.avgPassAtK(1).pipe(
        BenchMetric.mapGrade(({ pass }) => ({ pass })),
      ),
      {
        id: "average-pass-at-1",
        name: "Average pass@1",
        description: "Mean task-level pass@1 estimate across the benchmark.",
        chart: (result) => [
          Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
          Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
        ],
      },
    ),
  );
});

export const makeBench = (taskIds?: ReadonlyArray<string>) =>
  taskIds === undefined
    ? makeFullBench()
    : makeFullBench().pipe(Bench.select(taskIds));
```

The identity mapping in this example assumes the task grade already has `{ pass: boolean }`. If the real grade is `{ simPass: boolean }`, use the explicit mapping from the previous example. Keep the selection decision outside `makeFullBench` so the full benchmark remains the canonical source and subset metadata is set by the library.

## Validate Before Running

Before passing the value to `Eval.run`, check the benchmark-level invariants that the library does not infer:

```ts
const bench = yield* makeBench();
const ids = bench.tasks.map((task) => task.metadata.id);

if (new Set(ids).size !== ids.length) {
  throw new Error("Benchmark task IDs must be unique");
}

console.log({
  id: bench.metadata.id,
  subset: bench.metadata.subset,
  taskCount: bench.tasks.length,
  benchMetricCount: bench.metrics.length,
});
```

Also verify that:

- the source revision is pinned and the expected task count is known;
- every task has at least one stage and the final stage matches its template grade;
- each task's snapshot contains all files and tools required by its grader;
- metric `k` values do not exceed the configured trail count;
- benchmark metric grade mappings reflect the confirmed task grade semantics;
- subset selection is intentional and recorded through `metadata.subset`.

Then construct a harness and run the evaluation. See [Running evaluation](run-eval.md) for harness, trail count, verification mode, result handling, and event transport. For dataset loading details, keep the benchmark document focused on composition and consult the relevant `Tasks` loader or Harbor reference instead of adding source-specific logic here.

## Error Boundaries

Benchmark construction can fail with `BenchError` for initialization failures or for a metric attached to an unknown task ID. Preserve this typed failure in the Effect error channel until the application boundary. Do not catch it inside a loader and return an empty benchmark: that would produce a valid-looking evaluation with no meaningful task coverage.

## Review Checklist

- The benchmark ID is stable and the dataset source is pinned.
- Tasks are fully built (all stages and metrics attached) before the loader passed to `Bench.make` yields them.
- Task IDs are unique and task order is intentional.
- Task, trajectory, and benchmark metrics are attached at their correct scopes.
- Benchmark metrics use explicit grade mappings when their input shape differs from the task grade.
- The full benchmark is reusable; subsets are derived with `head`, `skip`, `tail`, `slice`, `select`, `selectAt`, `selectWhere`, `randomSelect`, or `sample` and are marked as subsets.
- Metric trail requirements fit the configured `trailCount`.
- Construction and loader failures remain typed Effect failures.
- The resulting benchmark is validated before `Eval.run`.
