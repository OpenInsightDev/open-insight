# Create a Bench Metric

A bench metric is a computation over completed trails across the tasks in one benchmark. It
produces a JSON object whenever another task trail result becomes available.

This document covers `BenchMetric`: defining and composing that computation. Attaching metrics to
a benchmark with `Bench.metric(...)` is a separate benchmark-building concern.

## Reduce-Like Executor

Create a custom metric with `BenchMetric.exec(...)`:

```ts
import { BenchMetric } from "@open-insight/eval";

const completionSummary = BenchMetric.exec(async (results) => ({
  tasks: Object.keys(results).length,
  trails: Object.values(results).reduce((total, trails) => total + trails.length, 0),
}));
```

The executor has this shape:

```ts
async (results, delta, prev) => result
```

- `results` contains completed trails grouped by task ID, including `delta`;
- `delta` is the newly completed trail together with its `task` ID;
- `prev` is this metric's previous result, or `null` on its first execution.

Each trail contains its final `grade`, `trajectory`, token `usage`, and start and finish times. The
metric must return a JSON object.

The three arguments support two styles. Use only `results` to analyze the full current benchmark
state:

```ts
const usageSummary = BenchMetric.exec(async (results) => ({
  outputTokens: Object.values(results).reduce(
    (benchTotal, trails) =>
      benchTotal +
      trails.reduce(
        (taskTotal, { usage }) => taskTotal + (usage.outputTokens.total ?? 0),
        0,
      ),
    0,
  ),
}));
```

Or treat `prev` as the accumulator and `delta` as the next input:

```ts
const usageSummary = BenchMetric.exec(async (_results, delta, prev) => {
  const completed = typeof prev?.completed === "number" ? prev.completed : 0;
  const outputTokens = typeof prev?.outputTokens === "number" ? prev.outputTokens : 0;

  return {
    completed: completed + 1,
    outputTokens: outputTokens + (delta.usage.outputTokens.total ?? 0),
  };
});
```

The framework supplies each returned object as `prev` on the next execution. Choose the full or
incremental form according to the calculation. Keep incremental state in `prev`, not in
module-level variables.

## Adapt the Grade

`BenchMetric.mapGrade(...)` adapts an executor to a different domain grade without changing task
grade schemas. It maps the grade in every trail in `results` and in `delta`; `prev` remains the
metric's previous output.

```ts
const averagePassAt5 = BenchMetric.avgPassAtK(5).pipe(
  BenchMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
);
```

The mapping must express an already-defined interpretation. Do not invent a threshold merely to
satisfy another metric's input.

## Built-In Metrics

The current built-ins are:

- `BenchMetric.avgPassAtK(k)`: mean task-level probability that at least one of `k` sampled trails
  passes;
- `BenchMetric.avgPassPowK(k)`: mean task-level probability that all `k` sampled trails pass.

Both compute the estimator separately for each observed task and then take the unweighted mean
across tasks. They consume grades shaped as `{ pass: boolean }` and work with
`BenchMetric.mapGrade(...)`.

Configure at least `k` trails per task. The final estimate is meaningful after every evaluated task
has at least `k` results.

## Checklist

- The metric analyzes completed trails across benchmark tasks.
- Full analysis preserves the grouping by task ID.
- Incremental analysis reduces `delta` into `prev`.
- The metric returns a JSON object.
- Grade adaptation is explicit and local to the metric.
- Incremental state is not shared outside the executor.
