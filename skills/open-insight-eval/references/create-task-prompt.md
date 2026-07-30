# Define Task Prompts

Read this document when a task stage needs anything beyond a static prompt. The `prompt` value on
each `Task.stage` is evaluated separately for each stage execution.

## Static Prompts

Use a string for one user message:

```ts
Task.stage("repair-checkout", {
  schema: GradeResult.fields,
  prompt:
    "A deployment caused some discount-code checkouts to charge twice. Find the regression, fix it without changing the public API, and add a regression test.",
  grader: async ({ $ }) => {
    // Compute and return the confirmed grade fields here.
    return {};
  },
});
```

Use raw messages when roles matter:

```ts
prompt: [
  {
    role: "system",
    content:
      "Act as the on-call engineer. Preserve payment audit records and do not disable idempotency checks.",
  },
  { role: "user", content: datapoint.incidentReport },
],
```

Keep the success criteria consistent with the confirmed grade contract, but do not expose hidden
reference answers or private grader implementation details.

## Prompt Functions

Use an async function to supply multiple inputs to the same agent session. This is useful for
replaying a multi-turn dataset or for asking another model to act as the user. After every agent
response, the function receives a context containing the full `trajectory` and the read-only sandbox
operations `$`, `cmd`, `readFile`, and `download`. Return the next raw prompt to continue or `null`
to stop prompting. Direct mutation APIs such as `writeFile`, `upload`, and `expose` are unavailable.

For example, replay the user turns from a conversation datapoint:

```ts
prompt: async ({ trajectory }) => {
  const completedTurns = trajectory.content.filter(
    (message) => message.role === "assistant",
  ).length;

  return datapoint.userTurns[completedTurns] ?? null;
},
```

The first call returns `userTurns[0]`. Each agent response advances the conversation to the next
dataset turn, and exhausting the dataset ends the stage.

A prompt function can also call an external LLM and use it as a simulated user:

```ts
import OpenAI from "npm:openai";

const simulatedUser = new OpenAI();
const simulatedUserModel = Deno.env.get("SIMULATED_USER_MODEL") ?? "gpt-5-mini";
const maxTurns = 4;

prompt: async ({ trajectory, readFile }) => {
  const assistantReplies = trajectory.content.filter(
    (message) => message.role === "assistant",
  );

  if (assistantReplies.length === 0) {
    return "Help me diagnose why checkout fails after I apply a discount code.";
  }
  if (assistantReplies.length >= maxTurns) {
    return null;
  }

  const checkoutConfig = await readFile({
    sandboxPath: "/workspace/config/checkout.json",
  });

  const transcript = trajectory.content
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      return `${message.role}: ${text}`;
    })
    .join("\n\n");

  const response = await simulatedUser.responses.create({
    model: simulatedUserModel,
    instructions:
      "Act as the same user. Answer questions with plausible details, challenge unsupported assumptions, and never solve the task yourself.",
    input: `Sandbox checkout config:\n${checkoutConfig}\n\nContinue this conversation with one user message:\n\n${transcript}`,
  });

  return response.output_text;
},
```

The function may be called repeatedly, so every dynamic conversation needs an explicit stop
condition such as dataset exhaustion, a turn limit, or a terminal state in the trajectory.

## Stateful Follow-ups

Use `{ init, followUp }` for a prompt with an optional initial message and multiple follow-ups. The
factory receives the current prompt context and returns a fresh async iterable for that stage run:

```ts
prompt: {
  init: "Investigate why checkout requests sometimes create two payment intents, then fix it.",
  followUp: async function* ({ trajectory, readFile }) {
    const initialReply = trajectory.content.findLast(
      (message) => message.role === "assistant",
    );
    const mentionsRegressionTest = initialReply?.content.some(
      (part) => part.type === "text" && /regression test/i.test(part.text),
    );

    if (!mentionsRegressionTest) {
      ({ trajectory } = yield "Reproduce the duplicate charge with a focused regression test.");
    }

    const testOutput = await readFile({ sandboxPath: "/workspace/test-output.log" });

    const latestReply = trajectory.content.findLast(
      (message) => message.role === "assistant",
    );
    const claimsTestsPass = latestReply?.content.some(
      (part) => part.type === "text" && /tests? pass/i.test(part.text),
    );

    if (!claimsTestsPass) {
      yield `The latest saved test output is below. Address it and report the exact result before finishing:\n\n${testOutput}`;
    }
  },
},
```

Each value yielded is converted into prompt messages. The context passed back into the iterator
contains the latest agent trajectory and sandbox access; assigning the result of `yield` lets later
follow-ups react to both. Let the iterator finish when no further instruction is needed.

## Stage Boundaries

Prefer separate `Task.stage` calls when phases have different grade schemas, verifier behavior, or
metrics. Prefer follow-up prompts when the work remains one graded phase and only the instruction
needs to react to the trajectory.

Set a stage's `resume` option only when session continuity is intentional. Its default is `true`.
Use `init` on the stage for sandbox setup that must run once before verifier checks or agent
interaction; do not use a prompt callback for filesystem initialization.
