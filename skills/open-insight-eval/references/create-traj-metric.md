# Create a Task-Specific Trajectory Metric

A trajectory metric observes one trail while the agent is responding. Use it for process-level measurements such as validation attempts, intermediate artifact state, or tool outcomes.

Use `Task.metric(...)` for metrics over completed grades and `Bench.metric(...)` for aggregation across tasks. A trajectory metric is not the task grade.

## Executor

Pass the executor directly to `Task.trajMetric(...)`. Its parameter and result types are inferred; do not annotate them manually.

The executor receives:

- `parts`: decoded parts observed in the current response so far;
- `prevTrajectory`: trajectory history from before the current response;
- `$`, `cmd`, `readFile`, and `download`: read-only sandbox operations;
- `prev`: this metric's previous result, or `null` on its first execution.

Use `prev` for incremental results. Recompute from `parts` when each result should be a current snapshot. Do not store metric state in module-level variables because trails may run concurrently.

Return a JSON object; TypeScript infers its shape from the executor. The framework validates only the general JSON-object shape at runtime, so decode untrusted command or file output inside the executor when stricter validation is required.

## Choose Between Part-Based and Schedule-Based Metrics

Choose by asking what produces the evidence for the metric.

### Part-Based: Measure What the Agent Just Did

Use `When.traj(...)` when a new message part is the evidence. The metric means: when the agent produces this kind of event, measure it.

Typical requirements:

- count or classify text and reasoning parts;
- measure a specific tool invocation after its result arrives;
- update a metric for every matching agent action;
- inspect sandbox state specifically at the moment an agent event occurs.

```ts
When.traj(When.part("text"));
When.traj(When.parts(["text", "reasoning"]));
When.traj(When.toolCall(validationTool));
```

Use the predicate closest to the evidence:

```ts
When.traj(
  When.part("text", {
    pred: (part) => part.text.includes(expectedMarker),
  }),
);

When.traj(
  When.toolCall(validationTool, {
    pred: ({ call, result }) => call.params !== undefined && !result.isFailure,
  }),
);
```

`When.toolCall(...)` represents a completed tool interaction: it provides the matching call and result together.

Without `when`, a trajectory metric defaults to `When.traj(When.part())`, so it measures every part.

### Schedule-Based: Observe State Independently of Agent Messages

Use `When.schedule(...)` when the sandbox is the evidence and it may change without the agent producing another message part. The metric means: check this state according to this polling policy, regardless of whether the agent says anything.

Typical requirements:

- observe progress from a long-running process;
- detect when a file, service, or build output becomes ready;
- sample resource or artifact state over time;
- run a metric when tests begin passing, even if no new message arrives at that moment.

```ts
When.schedule(When.spaced("2 seconds"), {
  pred: When.success(testCommand),
});
```

The schedule defines **when to check**. The optional `pred` defines **which checks should emit a metric result**. Use `When.success(command)`, `When.fails(command)`, and `When.content(...)` for common sandbox conditions.

### Decision Rule

Use `When.traj(...)` if removing the triggering message part would remove the meaning of the measurement. Use `When.schedule(...)` if the measurement must still happen while no new message part arrives.

Do not use a schedule merely to throttle a message-based metric. Do not rely on a part-based trigger to notice a later sandbox change: its sandbox predicate is reconsidered only when another matching part arrives.

## Attach the Metric

Define the executor, trigger, and metadata together at the task boundary:

```ts
import { Grade, Task, When } from "@open-insight/eval";

Task.make(taskOptions).pipe(
  Task.stage("solve", {
    prompt: "<task-specific prompt>",
    grader: Grade.make(GradeResult)(async () => ({})),
  }),
  Task.trajMetric(
    async ({ parts }, prev) => {
      const attempts = typeof prev?.attempts === "number" ? prev.attempts : 0;
      const rejected = typeof prev?.rejected === "number" ? prev.rejected : 0;
      const latest = parts.at(-1);

      if (latest?.type !== "tool-result") {
        return { attempts, rejected };
      }

      return {
        attempts: attempts + 1,
        rejected: rejected + Number(latest.isFailure),
      };
    },
    {
      id: "validation-progress",
      name: "Validation progress",
      description: "Validation attempts and rejected results in this trail.",
      when: When.traj(When.toolCall(validationTool)),
    },
  ),
);
```

The trigger runs after the matching part has been added to `parts`. Keep explicit narrowing in the executor so its assumptions remain visible if the trigger changes.

## Capture Task Values

The executor does not receive task extras or grades. Capture immutable per-task values directly from the task loader's scope:

```ts
Task.trajMetric(
  async ({ readFile }) => ({
    characters: (await readFile({ sandboxPath: taskArtifactPath })).length,
  }),
  {
    id: "artifact-state",
    name: "Artifact state",
    description: "Current size of the task artifact.",
    when: When.traj(When.toolCall(writerTool)),
  },
);
```

Let unexpected sandbox failures fail the metric. Handle an absent file only when absence is an expected, meaningful state.

## Charts and Metadata

Add a synchronous `chart` function only when the emitted result has a useful visual encoding:

```ts
chart: ({ attempts }) => [
  Chart.Bar.make({ legend: "Attempts", x: "Current trail", y: attempts }),
],
```

Import `Chart` from `@open-insight/eval`. Keep measurement in `exec`, not in `chart`.

Set a stable, task-unique `id` whenever results are stored or compared. Without an explicit ID, metric construction generates one. Add trajectory metrics after all stages.

## Checklist

- The metric measures one trail's process rather than its final grade.
- The trigger runs only when a new measurement is useful.
- The executor returns a JSON object and validates untrusted input.
- State is held in `prev`, not shared mutable variables.
- Per-task configuration is captured immutably.
- Sandbox access is observational.
- IDs are stable and unique within the task.
- All stages are added before `Task.trajMetric` is applied.
