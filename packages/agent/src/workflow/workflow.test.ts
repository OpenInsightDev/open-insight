import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow";
import * as A from "#/activity/index.ts";

const input: A.TaskInput = {
  taskId: "task-1",
  instruction: "Write a result file and report.",
  sandbox: { image: "node:22" },
  toolkits: [],
  acceptance: {
    stages: [
      { id: "stage-1", title: "Write", checks: [] },
      { id: "stage-2", title: "Report", checks: [] },
    ],
  },
  maxSteps: 5,
};

const modelCalls: Array<number> = [];
const ModelTest = Layer.succeed(A.Model)(
  A.Model.of({
    step: ({ step }) =>
      Effect.sync(() => {
        modelCalls.push(step);
        if (step === 1) {
          return new A.ModelStepRecord({
            step,
            parts: [
              new A.TextPart({ text: "I will write the result file." }),
              new A.ToolCallPart({
                call: new A.ToolCall({
                  id: "call-1",
                  name: "WriteFile",
                  params: { path: "/workspace/result.txt", content: "hello" },
                }),
              }),
            ],
            usage: new A.UsageStats({ inputTokens: 1, outputTokens: 1 }),
          });
        }
        return new A.ModelStepRecord({
          step,
          parts: [new A.TextPart({ text: "The result is ready." })],
          usage: new A.UsageStats({ inputTokens: 1, outputTokens: 1 }),
        });
      }),
  }),
);

const toolNames: Array<string> = [];
const WorkspaceTest = Layer.succeed(A.Workspace)(
  A.Workspace.of({
    acquire: ({ executionId, spec }) => Effect.succeed({ executionId, spec }),
    release: () => Effect.void,
    runTools: (handle, calls) =>
      Effect.sync(() => {
        toolNames.push(...calls.map((call) => call.name));
        return new A.ToolBatchRecord({
          calls: [...calls],
          results: calls.map((call) => new A.ToolResultOk({ value: { id: call.id, ok: true } })),
        });
      }),
    checkpoint: (handle, message) =>
      Effect.succeed(new A.CheckpointRecord({ commit: `commit-${message}`, message })),
  }),
);

const verifiedStages: Array<string> = [];
const VerifierTest = Layer.succeed(A.Verifier)(
  A.Verifier.of({
    verifyStage: ({ stage }) =>
      Effect.sync(() => {
        verifiedStages.push(stage);
        return new A.StageVerdict({ stage, passed: true, checks: [] });
      }),
  }),
);

const provideTestLayers = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.provide(
    Effect.provide(Effect.provide(program, A.layer), WorkflowEngine.layerMemory),
    Layer.mergeAll(ModelTest, WorkspaceTest, VerifierTest),
  );

it.effect("runs the durable agent loop to completion", () =>
  provideTestLayers(
    Effect.gen(function* () {
      const result = yield* A.AgentTask.execute(input);

      assert.deepStrictEqual(modelCalls, [1, 2]);
      assert.deepStrictEqual(verifiedStages, ["stage-1", "stage-2"]);
      assert.deepStrictEqual(toolNames, ["WriteFile"]);
      assert.lengthOf(result.artifacts, 2);
      assert.include(result.answer, "result is ready");
      assert.strictEqual(result.usage.inputTokens, 2);
    }),
  ),
);

it.effect("is idempotent per task id", () =>
  provideTestLayers(
    Effect.gen(function* () {
      modelCalls.length = 0;
      const first = yield* A.AgentTask.execute(input);
      const second = yield* A.AgentTask.execute(input);

      assert.deepStrictEqual(first, second);
      // the model was not called again for the second submission
      assert.deepStrictEqual(modelCalls, [1, 2]);
    }),
  ),
);
