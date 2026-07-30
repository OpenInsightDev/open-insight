# Define Task Grading

The grade is a domain contract, not merely a metric input. Establish it from the task's actual
acceptance criteria and confirm it with the user before writing schemas, graders, or metrics.

## Grade Discovery

Inspect the available evidence first:

- task instructions and expected deliverables;
- dataset fields and reference outputs;
- test runners, simulators, linters, or judge scripts;
- existing result consumers and published metrics;
- known-good and known-bad examples.

Propose the smallest result object that preserves the distinctions users need. For each field,
state its type, meaning, source, range or units, and how failure is represented. Explicitly ask
whether one combined field or multiple diagnostic fields are desired.

Do not assume one of these common shapes without confirmation:

```ts
{ passed: boolean }
{ score: number }
{ passed: boolean, testsPassed: number, testsTotal: number }
```

Also confirm which field maps to pass/fail metrics. A numeric score does not imply a pass threshold
unless the user or benchmark specification defines one.

## Grade Schemas

After confirmation, define a named class whose encoded form is a JSON object:

```ts
class GradeResult extends Schema.Class<GradeResult>("<Benchmark>GradeResult")({
  // Add exactly the confirmed fields, schemas, constraints, and annotations.
}) {}
```

This is a structural placeholder. Do not preserve its class identifier or empty field set in an
implementation.

The final `Task.stage` must use the template's grade schema. An intermediate stage may use a
different named schema. Later graders can read prior decoded results through `results.<stageName>`.

## Grader Behavior

A normal stage grader runs against the agent sandbox and receives sandbox operations together with:

- `trajectory`, the agent trajectory for the current stage;
- `results`, all preceding stage results keyed by stage name.

Return the schema's encoded JSON object. Let infrastructure or malformed-output failures fail the
grader unless the confirmed grade semantics explicitly classify them as a valid negative result.
For example, a judge command's non-zero exit may represent a valid negative grade if the benchmark
defines it that way, while failure to locate the judge usually indicates a broken benchmark and
should not be silently converted.

```ts
grader: async ({ $, results, trajectory }) => {
  // Run the benchmark's judge and parse its output here.
  // Use results only when this stage depends on preceding stages.
  return {
    // Return exactly the confirmed grade fields.
  };
},
```

Keep parsing deterministic. Prefer structured test output when the runner supports it.
Design judge scripts to exit successfully when they produced a valid failing grade report. Reserve
process failures for cases where the benchmark could not compute a grade.

## Verification

Add `verif` and `expect` together to prove that the grader recognizes a known-good state without
running the real agent. `verif` prepares that state and may return a trajectory prompt or `null`.
The resulting grade is deep-compared with `expect`.

```ts
Task.stage("solve", {
  schema: template.grade.fields,
  prompt: "<task-specific prompt>",
  grader: async ({ $, results, trajectory }) => {
    // Compute the confirmed grade from the current sandbox state.
    return {};
  },
  verif: async ({ $, upload, writeFile }) => {
    // Prepare the confirmed reference state directly in this verifier.
    return null;
  },
  expect: {
    // Write the exact expected encoded grade fields here.
  },
});
```

Use exact expected values for every grade field. Do not add verifier-only fields to the grade.

## Retries

Use `Grade.retry(prompt)` only when the agent can act on feedback and another attempt is part of the
task design. Throwing the retry value requests another prompt instead of producing a grade:

```ts
import { Grade } from "@open-insight/eval";

grader: async ({ $, results, trajectory }) => {
  // Inspect the retry condition here.
  if (/* the confirmed retry condition */) {
    throw Grade.retry("<actionable follow-up prompt>");
  }
  // Compute and return the confirmed grade here.
  return {};
},
```

Do not retry infrastructure failures or use retries to conceal an ambiguous grade contract.

## Metric Compatibility

Metrics consume the confirmed final grade, but metric design does not determine the grade schema.
Prefer metrics that operate directly on that grade. When an existing metric requires another grade
shape, use `TaskMetric.mapGrade(...)` at the `Task.metric` call site and implement the mapping
there. Do not add or rename grade fields to satisfy a metric, and do not invent a pass/fail
interpretation unless the user confirms one.
