# Create a Task Metric

A task metric is a computation over the completed trails of one task. It produces a JSON object whenever another trail result becomes available.

This document covers the computation itself and the built-ins in `Metric.Task`. Attaching one or more metrics to a task with `Task.metric(...)` is a separate task-building concern; constructing a metric standalone with `Metric.Task.make(...)` is only needed when you want to reuse or run it outside a task pipeline.

## Reduce-Like Executor

Pass the executor to `Task.metric(exec, options)` to attach it to a task, or to `Metric.Task.make({ exec, ... })` to construct it standalone:

```ts
import { Task } from "@open-insight/eval";

Task.metric(async (results) => ({
  completed: results.length,
}), {
  id: "completed-trails",
  name: "Completed trails",
});
```

The executor has this shape:

```ts
async (results, delta, prev) => result
```

- `results` contains every completed trail so far, including `delta`;
- `delta` is the newly completed trail;
- `prev` is this metric's previous result, or `null` on its first execution.

Each trail contains its final decoded `grade`, `trajectory`, token `usage` (or `null`), and `startedAt` / `finishedAt` timestamps. When a grader uses a `Schema.Class`, `trail.grade` is the class instance rather than the schema constructor, so its declared fields are available directly. The metric must return a JSON object.

The three arguments support two styles. Use only `results` to analyze the full current set:

```ts
Task.metric(async (results) => ({
  completed: results.length,
  outputTokens: results.reduce(
    (total, { usage }) => total + (usage?.outputTokens.total ?? 0),
    0,
  ),
}), {
  id: "usage-summary",
  name: "Usage summary",
});
```

Or treat `prev` as the accumulator and `delta` as the next input:

```ts
Task.metric(async (_results, delta, prev) => {
  const completed = typeof prev?.completed === "number" ? prev.completed : 0;
  const outputTokens = typeof prev?.outputTokens === "number" ? prev.outputTokens : 0;

  return {
    completed: completed + 1,
    outputTokens: outputTokens + (delta.usage?.outputTokens.total ?? 0),
  };
}, {
  id: "usage-total",
  name: "Usage total",
});
```

The framework supplies each returned object as `prev` on the next execution. Choose the full or incremental form according to the calculation. Keep incremental state in `prev`, not in module-level variables.

## Adapt the Grade

`Task.mapMetric(mapper, exec, options)` adapts an executor to a different domain grade without changing the task's grade schema. It maps the grade in both `results` and `delta`; `prev` remains the metric's previous output.

```ts
Task.mapMetric(({ simPass }) => ({ pass: simPass }), Metric.Task.passAtK(5), {
  id: "pass-at-5",
  name: "Pass@5",
});
```

The mapping must express an already-defined interpretation. Do not invent a threshold merely to satisfy another metric's input type.

## Built-In Metrics

The current built-ins are exported from `Metric.Task`:

- `Metric.Task.passAtK(k)`: estimated probability that at least one of `k` sampled trails passes;
- `Metric.Task.passPowK(k)`: estimated probability that all `k` sampled trails pass.

Both consume grades shaped as `{ pass: boolean }` and return an executor compatible with `Task.mapMetric(...)`. Configure at least `k` trails; the final estimate is meaningful once at least `k` results have been observed.

## Metadata and Charts

`Task.metric` accepts optional `id`, `name`, `description`, and a synchronous `chart` function. Set a stable, task-unique `id` whenever results are stored or compared; without an explicit ID, metric construction generates one. Keep measurement in `exec`, not in `chart`.

## Checklist

- The metric analyzes completed trails from one task.
- It either analyzes `results` directly or reduces `delta` into `prev`.
- It returns a JSON object.
- Grade adaptation is explicit and local to the metric (`Task.mapMetric`).
- Incremental state is not shared outside the executor.
