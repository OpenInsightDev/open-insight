# Create a Task

A task is an Effect-built definition with four parts:

1. schema contracts for task metadata and the final grade;
2. a `Task.Template` shared by tasks with those contracts;
3. one or more ordered stages that prompt and grade the agent;
4. task and trajectory metrics attached before `Task.build`.

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
to schemas, the template, or task construction. See
[Define grading](create-task-grade.md) for the full discovery checklist and grader rules.

## 2. Define Extras and Grade Fields

After confirmation, define the field schemas directly in the template. `extras` contains per-task
dataset metadata that is not part of the base task metadata. `grade` is the output schema of the
final stage. Keep task inputs, diagnostics, and grade fields separate. Do not add a field solely
because a built-in metric expects a different shape; `mapGrade` adapts the confirmed grade to the
metric instead.

If tasks need no extras, omit `Extras` from the template and `extras` from `Task.make` rather than creating
an empty class.

## 3. Create the Template

Create one template for all tasks that share the contracts:

```ts
const template = Task.Template.make({
  Extras: {
    // Add only the per-task metadata fields established for this benchmark.
  },
  Grade: {
    // Add exactly the grade fields and constraints confirmed by the user.
  },
});
```

The template is schema-only. It does not contain task values, prompts, stages, or metrics.
`template.Grade` must match the result schema of the final stage. Intermediate stages may use
different schema classes.

`Task.Template.make` accepts struct fields and constructs the schemas.

Without extras:

```ts
const template = Task.Template.make({
  Grade: {
    // Add exactly the confirmed grade fields.
  },
});
```

## 4. Make and Build the Task

Pass the template to `Task.make`, then compose stages and metrics in a single pipe. `Task.make`
returns an `Effect`, so return or yield the completed pipeline rather than treating it as a plain
task value.

```ts
import { Task, When } from "@open-insight/eval";

Task.make(template, {
  id: taskId,
  name: taskName,
  snapshot,
  extras: {
    // Set the confirmed per-task metadata fields here.
  },
}).pipe(
  Task.stage("solve", {
    schema: template.Grade.fields,
    prompt: "<task-specific prompt>",
    grader: async ({ $, results, trajectory }) => {
      // Inspect the sandbox and trajectory, then compute the confirmed grade fields here.
      return {
        // Return exactly the encoded template grade fields.
      };
    },
    // Add verif and expect together here only when verifier mode is required.
  }),
  Task.metric(
    async (results) => ({ completedTrails: results.length }),
    {
      name: "Completed trails",
      description: "Number of trails incorporated into this task metric.",
    },
  ),
  Task.trajMetric(async ({ parts }) => ({ observedParts: parts.length }), {
    name: "Observed parts",
    description: "Number of response parts observed in the current trajectory.",
    when: When.traj(When.toolCall()),
  }),
  Task.build,
);
```

This is a composition skeleton. Replace every angle-bracket value and comment with the benchmark's
confirmed definitions. Define stage behavior and metric metadata at their call sites; do not create
one-use constants merely to pass them into the pipe.

Keep this pipe order:

1. `Task.stage(...)` in execution order;
2. `Task.metric(...)` for metrics computed across completed trails of this task;
3. `Task.trajMetric(...)` for metrics computed from one trajectory's event stream;
4. `Task.build` last.

### `Task.make` Values

Provide:

- `id`, `name`, and `snapshot`;
- optional base metadata such as `description`, `keywords`, and `authors`;
- optional `resources`;
- `extras` exactly when the template declares an extras schema.

`extras` uses the schema's encoded input shape and is decoded while building the task. For
example, a `Schema.NumberFromString` field accepts its string encoding in `Task.make` and becomes a
number on the built task.

### Stage Composition

Each stage must provide a unique name, its own result `schema`, a `prompt`, and a `grader`.
Stages execute in pipe order. A later grader receives all prior results keyed by stage name:

```ts
class PreparationResult extends Schema.Class<PreparationResult>("<Benchmark>PreparationResult")({
  // Fields produced by this intermediate stage.
}) {}

Task.make(template, {
  id: taskId,
  name: taskName,
  snapshot,
  extras: {
    // Set the confirmed per-task metadata fields here.
  },
}).pipe(
  Task.stage("prepare", {
    schema: PreparationResult.fields,
    prompt: "<preparation-stage prompt>",
    grader: async ({ $, trajectory }) => {
      // Compute and return the PreparationResult fields here.
      return {};
    },
  }),
  Task.stage("solve", {
    schema: template.Grade.fields,
    prompt: "<final-stage prompt>",
    grader: async ({ $, results, trajectory }) => {
      const preparation = results.prepare;
      // Use preparation and the current sandbox state to compute the final grade here.
      return {};
    },
  }),
  Task.build,
);
```

The final stage result must conform to `template.Grade`; `Task.build` enforces that relationship at
the type level. Read [Define prompts](create-task-prompt.md) before using generated or multi-turn
prompts. Read [Define grading](create-task-grade.md) before using verification, retries, or multiple
stages.

`Task.stage` accepts struct fields and constructs the result schema. Use `Task.stage.from` when a
stage needs a complete schema, such as a named `Schema.Class` or a root `Schema.Record`.

### Metric Selection

Attach only metrics that answer a stated evaluation question.

Treat the constructors currently exported by `TaskMetric` and `TrajMetric` as conveniences, not as
a closed catalog. Inspect the current exports before choosing an implementation; more built-in
metrics may be added over time. See [Create a task metric](create-task-metric.md) when defining or
composing a custom `TaskMetric` computation.

Attach the selected task metric with `Task.metric(...)` and the selected trajectory metric with
`Task.trajMetric(...)`. Use `TaskMetric.mapGrade(...)` only when the selected metric requires a
different view of the confirmed grade. Define metric `name`, `description`, and trigger at the
corresponding call site.

Do not rename or flatten the domain grade to satisfy a metric. Adapt it at the metric boundary when
the confirmed metric design requires that mapping. See
[Create a bench metric](create-bench-metric.md) for benchmark-wide aggregation, then attach it with
`Bench.metric`, not on an individual task. Keep chart construction out of the task workflow; see
[Define task charts](create-task-chart.md).

## Review Checklist

- The user explicitly confirmed the actual final grade fields and semantics.
- `Extras` and every stage result use named `Schema.Class` definitions where reusable.
- The template contains only `Extras` and the final `Grade` schema.
- `Task.make` uses that template and provides correctly encoded extras.
- Stage names are unique and ordered; the final stage schema matches `template.Grade`.
- `verif` and `expect` either appear together or are both absent.
- Graders return schema-compatible JSON objects and do not hide infrastructure failures as passes.
- Any required grade mapping is explicit, and `Task.build` is the last pipe operation.
