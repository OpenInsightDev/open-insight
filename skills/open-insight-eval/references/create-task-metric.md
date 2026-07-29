# Create a Task Metric

A task metric is a computation over the completed trails of one task. It produces a JSON object
whenever another trail result becomes available.

This document covers `TaskMetric`: defining and composing that computation. Attaching one or more
metrics to a task with `Task.metric(...)` is a separate task-building concern.

## Reduce-Like Executor

Create a custom metric with `TaskMetric.exec(...)`:

```ts
import { TaskMetric } from "@open-insight/eval";

const completedTrails = TaskMetric.exec(async (results) => ({
  completed: results.length,
}));
```

The executor has this shape:

```ts
async (results, delta, prev) => result
```

- `results` contains every completed trail so far, including `delta`;
- `delta` is the newly completed trail;
- `prev` is this metric's previous result, or `null` on its first execution.

Each trail contains its final `grade`, `trajectory`, token `usage`, and start and finish times. The
metric must return a JSON object.

The three arguments support two styles. Use only `results` to analyze the full current set:

```ts
const usageSummary = TaskMetric.exec(async (results) => ({
  completed: results.length,
  outputTokens: results.reduce(
    (total, { usage }) => total + (usage.outputTokens.total ?? 0),
    0,
  ),
}));
```

Or treat `prev` as the accumulator and `delta` as the next input:

```ts
const tokenSummary = TaskMetric.exec(async (_results, delta, prev) => {
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

`TaskMetric.mapGrade(...)` adapts an executor to a different domain grade without changing the
task's grade schema. It maps the grade in both `results` and `delta`; `prev` remains the metric's
previous output.

```ts
const passAt5 = TaskMetric.passAtK(5).pipe(
  TaskMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
);
```

The mapping must express an already-defined interpretation. Do not invent a threshold merely to
satisfy another metric's input type.

## Built-In Metrics

The current built-ins are:

- `TaskMetric.passAtK(k)`: estimated probability that at least one of `k` sampled trails passes;
- `TaskMetric.passPowK(k)`: estimated probability that all `k` sampled trails pass.

Both consume grades shaped as `{ pass: boolean }` and return an executor compatible with
`TaskMetric.mapGrade(...)`. Configure at least `k` trails; the final estimate is meaningful once at
least `k` results have been observed.

## Checklist

- The metric analyzes completed trails from one task.
- It either analyzes `results` directly or reduces `delta` into `prev`.
- It returns a JSON object.
- Grade adaptation is explicit and local to the metric.
- Incremental state is not shared outside the executor.
