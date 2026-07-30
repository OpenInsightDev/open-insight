# Define Task Prompts

Read this document when a task stage needs anything beyond a static prompt. The `prompt` value on
each `Task.stage` is evaluated separately for each stage execution.

## Static Prompts

Use a string for one user message:

```ts
Task.stage("solve", {
  schema: GradeResult.fields,
  prompt: "Implement the requested function and run the tests.",
  grader: async ({ $ }) => {
    // Compute and return the confirmed grade fields here.
    return {};
  },
});
```

Use raw messages when roles matter:

```ts
prompt: [
  { role: "system", content: "Work only in /workspace." },
  { role: "user", content: datapoint.prompt },
],
```

Keep the success criteria consistent with the confirmed grade contract, but do not expose hidden
reference answers or private grader implementation details.

## Prompt Functions

Use an async function when the next prompt depends on the full trajectory. Return a raw prompt to
continue or `null` to stop prompting:

```ts
prompt: async (trajectory) => {
  const hasAssistantReply = trajectory.content.some((message) => message.role === "assistant");
  return hasAssistantReply ? null : "Inspect the repository before answering.";
},
```

The function may be called repeatedly. Make its stop condition explicit so it cannot create an
unbounded prompt loop.

## Stateful Follow-ups

Use `{ init, followUp }` for a prompt with an optional initial message and multiple follow-ups. The
factory receives the current trajectory and returns a fresh async iterable for that stage run:

```ts
prompt: {
  init: "Implement the change and run the relevant tests.",
  followUp: async function* (trajectory) {
    if (trajectory.content.some((message) => message.role === "assistant")) {
      yield "Check the failing test output and correct the implementation.";
      yield "Run the focused test once more and finish.";
    }
  },
},
```

Each value yielded is converted into prompt messages. The trajectory passed back into the iterator
contains the agent session accumulated so far. Let the iterator finish when no further instruction
is needed.

## Stage Boundaries

Prefer separate `Task.stage` calls when phases have different grade schemas, verifier behavior, or
metrics. Prefer follow-up prompts when the work remains one graded phase and only the instruction
needs to react to the trajectory.

Set a stage's `resume` option only when session continuity is intentional. Its default is `true`.
Use `init` on the stage for sandbox setup that must run once before verifier checks or agent
interaction; do not use a prompt callback for filesystem initialization.
