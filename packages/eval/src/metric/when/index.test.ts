import { Prompt } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";
import { part, parts, toolCall } from "./index.ts";

const textPart = Prompt.textPart({ text: "task complete" });
const reasoningPart = Prompt.reasoningPart({ text: "still working" });

it("filters parts by content", () => {
  const matches = part("text", {
    pred: (part) => part.text.includes("complete"),
  });

  assert.isTrue(matches(textPart, [textPart]));
  assert.isFalse(matches(Prompt.textPart({ text: "in progress" }), [textPart]));
});

it("does not evaluate the content predicate for a different part type", () => {
  let calls = 0;
  const matches = part("text", {
    pred: () => {
      calls += 1;
      return true;
    },
  });

  assert.isFalse(matches(reasoningPart, [reasoningPart]));
  assert.strictEqual(calls, 0);
});

it("filters several part types by content", () => {
  const matches = parts(["text", "reasoning"], {
    pred: (part) => part.text.includes("complete"),
  });

  assert.isTrue(matches(textPart, [textPart]));
  assert.isFalse(matches(reasoningPart, [reasoningPart]));
});

it("filters tool calls by result content", () => {
  const callPart = Prompt.toolCallPart({
    id: "call-1",
    name: "bash",
    params: { command: "echo done" },
    providerExecuted: false,
  });
  const resultPart = Prompt.toolResultPart({
    id: "call-1",
    name: "bash",
    isFailure: false,
    result: "done",
  });
  const matches = toolCall("bash", {
    pred: ({ call, result }) =>
      call.params !== undefined && !result.isFailure && result.result === "done",
  });

  assert.isTrue(matches(resultPart, [callPart, resultPart]));
  assert.isFalse(matches(resultPart, [resultPart]));
  assert.isFalse(toolCall("read")(resultPart, [callPart, resultPart]));
});
