# Create a Task

A task is an Effect-built definition with four parts:

1. task metadata and the schema contract for the final grade;
2. a `Task.make` call that supplies the metadata, snapshot, and resources;
3. one or more ordered stages that prompt and grade the agent;
4. task and trajectory metrics attached after the final stage.

Use this workflow in order. Do not write a grader or invent a generic `passed` or `score` field
until the user confirms what the task must actually measure.

## 1. Confirm the Grade Contract

First inspect any task description, dataset, reference solution, test harness, and existing grader.
Then tell the user the proposed final grade shape and ask them to confirm it. Include:

- every field name, type, and meaning;
- whether a boolean, score, count, category, or diagnostic is the authoritative outcome;
- valid ranges, units, and optional or nullable behavior;
- which field, if any, maps to pass/fail metrics;
- what a known-good solution should return when verifier mode is needed.

For a multi-stage task, distinguish intermediate stage results from the final grade. Ask the user
to confirm both when an earlier stage records data used by a later stage.

Use a concrete proposal rather than an open-ended question. State the proposed object shape, define
each field in domain language, cite the evidence for that proposal, and list any unresolved choice.
Ask the user to confirm or correct the proposal.

Wait for the answer. If the evidence does not establish a unique grade contract, do not continue
to schemas, task construction, or graders. See
[Define grading](create-task-grade.md) for the full discovery checklist and grader rules.

## 2. Define the Grade Schema

After confirmation, define the final grade as a named `Schema.Class` whose encoded form is a JSON
object. Keep task inputs, diagnostics, and grade fields separate. Do not add a field solely
because a built-in metric expects a different shape; `Task.mapMetric` adapts the confirmed grade to
the metric instead.

```ts
import { Schema } from "effect";

class SolveGrade extends Schema.Class<SolveGrade>("SolveGrade")({
  // Add exactly the grade fields and constraints confirmed by the user.
}) {}
```

An intermediate stage may use its own named schema. The final stage's grade schema is the task
grade; there is no separate "end stage" constructor — the last `Task.stage` in the pipe is the
final stage.

## 3. Make and Build the Task

Call `Task.make` with the task metadata, the snapshot, and optional resources, then compose stages
and metrics in a single pipe. `Task.make` returns an `Effect`, so return or yield the completed
pipeline rather than treating it as a plain task value.

```ts
import { Grade, Task, When } from "@open-insight/eval";
import { Schema } from "effect";

Task.make({
  id: taskId,
  name: taskName,
  snapshot,
  // Optional metadata:
  description: "One-line description",
  keywords: ["python", "rewardkit"],
  authors: ["Jane Doe"],
  // Optional resources (defaults to empty Resource.Resources):
  resources,
}).pipe(
  Task.stage("solve", {
    prompt: "<task-specific prompt>",
    grader: Grade.make(SolveGrade)(async ({ $, prevResults, trajectory }) => {
      // Inspect the sandbox and trajectory, then compute the confirmed grade fields here.
      return {
        // Return exactly the encoded grade fields.
      };
    }),
  }),
  Task.metric(async (results) => ({ completedTrails: results.length }), {
    id: "completed-trails",
    name: "Completed trails",
    description: "Number of trails incorporated into this task metric.",
  }),
  Task.trajMetric(async ({ parts }) => ({ observedParts: parts.length }), {
    id: "observed-parts",
    name: "Observed parts",
    description: "Number of response parts observed in the current trajectory.",
    when: When.traj(When.toolCall()),
  }),
);
```

This is a composition skeleton. Replace every angle-bracket value and comment with the benchmark's
confirmed definitions. Define stage behavior and metric metadata at their call sites; do not create
one-use constants merely to pass them into the pipe.

Keep this pipe order:

1. `Task.make({ ... })` with the task metadata, snapshot, and resources;
2. `Task.stage(name, ...)` for each stage, in execution order; the last stage's grade schema is
   the final grade;
3. `Task.metric(...)` / `Task.mapMetric(...)` for metrics computed across completed trails of this
   task;
4. `Task.trajMetric(...)` for metrics computed from one trajectory's event stream.

### `Task.make` Values

Provide:

- `id`, `name`, and `snapshot`;
- optional base metadata such as `description`, `keywords`, and `authors`;
- optional `resources` (`Resource.Resources`; defaults to empty when omitted).

Metadata is decoded while building the task, and the fields are fixed: `id`, `name`, `description`,
`keywords`, and `authors`. There is no `extras` container on a task — per-task dataset metadata
belongs in the benchmark or dataset layer, not in `Task.make`.

### Stage Composition

Each stage must provide a unique name, its own grade schema (via `Grade.make(schema)`), a `prompt`,
and a `grader`. Stages execute in pipe order. A later grader receives all prior results keyed by
stage name through `prevResults`:

```ts
class PreparationResult extends Schema.Class<PreparationResult>("<Benchmark>PreparationResult")({
  // Fields produced by this intermediate stage.
}) {}

Task.make({
  id: taskId,
  name: taskName,
  snapshot,
}).pipe(
  Task.stage("prepare", {
    prompt: "<preparation-stage prompt>",
    grader: Grade.make(PreparationResult)(async ({ $, trajectory }) => {
      // Compute and return the PreparationResult fields here.
      return {};
    }),
  }),
  Task.stage("solve", {
    prompt: "<final-stage prompt>",
    grader: Grade.make(SolveGrade)(async ({ $, prevResults, trajectory }) => {
      const preparation = prevResults.prepare;
      // Use preparation and the current sandbox state to compute the final grade here.
      return {};
    }),
  }),
);
```

The last stage's grader uses the confirmed final grade schema. Read
[Define prompts](create-task-prompt.md) before using generated or multi-turn
prompts. Read [Define grading](create-task-grade.md) before using verification, retries, or multiple
stages.

### Metric Selection

Attach only metrics that answer a stated evaluation question.

Treat the built-in constructors currently exported by `Metric.Task` and `Metric.Traj` as
conveniences, not as a closed catalog. Inspect the current exports before choosing an
implementation; more built-in metrics may be added over time. See
[Create a task metric](create-task-metric.md) when defining or composing a custom task metric
computation.

Attach the selected task metric with `Task.metric(...)` and the selected trajectory metric with
`Task.trajMetric(...)`. Use `Task.mapMetric(...)` only when the selected metric requires a
different view of the confirmed grade. Define metric `id`, `name`, `description`, and trigger at
the corresponding call site.

Do not rename or flatten the domain grade to satisfy a metric. Adapt it at the metric boundary when
the confirmed metric design requires that mapping. See
[Create a bench metric](create-bench-metric.md) for benchmark-wide aggregation, then attach it with
`Bench.metric`, not on an individual task. Keep chart construction out of the task workflow; see
[Define task charts](create-task-chart.md).

## Review Checklist

- The user explicitly confirmed the actual final grade fields and semantics.
- The final grade and every intermediate stage result use named `Schema.Class` definitions.
- `Task.make` provides the metadata, snapshot, and resources.
- Stage names are unique and ordered; the last stage's grader uses the final grade schema.
- `verif` and `expect` are defined together in `Grade.make` or are both absent.
- Graders return schema-compatible JSON objects and do not hide infrastructure failures as passes.
- Any required grade mapping is explicit, and the final stage precedes task metrics.
