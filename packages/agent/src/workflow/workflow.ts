/**
 * The durable agent task workflow.
 *
 * One task execution is one workflow. `AgentTask` drives the agent loop:
 *
 * ```
 * for each step:
 *   1. model step      (activity, journaled)
 *   2. tool batch      (activity, journaled)  — sandbox mutations
 *   3. git checkpoint  (activity, journaled)  — durable trajectory checkpoint
 *   4. stage verify    (activity, journaled)  — acceptance DAG
 *      passed + final  → TaskResult
 *      passed          → advance stage
 *      failed          → suspend for human review, resume on approval
 * max steps exceeded   → fail
 * ```
 *
 * Durability properties:
 *
 * - `executionId = hash(tag, idempotencyKey(payload))` with
 *   `idempotencyKey = taskId`, so re-submitting the same task is a no-op.
 * - The workflow body is deterministic orchestration; every external side
 *   effect is an activity, so on crash the engine replays the journal and the
 *   loop resumes from the last journaled step.
 * - The trajectory is re-folded from journaled parts; the sandbox is a
 *   disposable worktree reconstructed from git checkpoints.
 * - Human review suspends the workflow (no journaled approval yet) and
 *   resumes it when an external reviewer completes the `DurableDeferred`
 *   (e.g. `DurableDeferred.succeed`), or when `AgentTask.resume(executionId)`
 *   is called.
 *
 * Not modeled yet (extension points): a timeout race on the approval wait
 * (`DurableClock.sleep` raced against the deferred), and refinement of
 * acceptance-DAG edges into subgraphs at runtime.
 */
import { Effect, Layer, Option, Ref } from "effect";
import {
  DurableDeferred,
  Workflow,
  type WorkflowEngine as WorkflowEngineNS,
} from "effect/unstable/workflow";
import * as Acts from "./activities.ts";
import { ActivityError, MaxStepsExceeded, StageRejected } from "./error.ts";
import * as S from "./schema.ts";
import { Workspace, type Model, type Verifier, type WorkspaceHandle } from "./service.ts";

export const AgentTask = Workflow.make("agent/AgentTask", {
  payload: S.TaskInput,
  success: S.TaskResult,
  error: ActivityError,
  idempotencyKey: (payload) => payload.taskId,
});

const toolCallsOf = (record: S.ModelStepRecord): ReadonlyArray<S.ToolCall> =>
  record.parts.flatMap((part) => (part._tag === "tool-call" ? [part.call] : []));

const run = (payload: S.TaskInput, executionId: string) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;

    // Workspace acquisition is keyed by executionId and must be idempotent on
    // replay (the implementation reconstructs the sandbox from the last
    // checkpoint). If the whole workflow fails, compensation releases it.
    const handleRef = yield* Ref.make(Option.none<WorkspaceHandle>());
    const handle = yield* workspace.acquire({ executionId, spec: payload.sandbox }).pipe(
      Effect.tap((h) => Ref.set(handleRef, Option.some(h))),
      Workflow.withCompensation((_, _cause) =>
        Ref.get(handleRef).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (h) => workspace.release(h).pipe(Effect.ignore),
            }),
          ),
        ),
      ),
    );

    // The trajectory is folded incrementally from journaled parts, so it is
    // reconstructed deterministically on replay.
    const trajectory: Array<S.StepPart> = [];
    const answer: Array<string> = [];
    const usage: Array<S.UsageStats> = [];
    const artifacts: Array<string> = [];
    let stageIndex = 0;

    for (let step = 1; step <= payload.maxSteps; step++) {
      const stage = payload.acceptance.stages[stageIndex];
      if (stage === undefined) break;

      // 1. durable model step
      const record = yield* Acts.modelStep(step, trajectory);
      trajectory.push(...record.parts);
      usage.push(record.usage);
      for (const part of record.parts) {
        if (part._tag === "text") answer.push(part.text);
      }

      // 2. durable tool batch (sandbox mutations)
      const calls = toolCallsOf(record);
      if (calls.length > 0) {
        const batch = yield* Acts.toolBatch(step, handle, calls);
        trajectory.push(...batch.results.map((result) => new S.ToolResultPart({ result })));
      }

      // 3. durable git checkpoint — the trajectory's durable record
      const checkpoint = yield* Acts.gitCheckpoint(step, handle);
      artifacts.push(checkpoint.commit);

      // 4. stage acceptance (acceptance DAG)
      const verdict = yield* Acts.verifyStage(stage.id, handle);
      if (verdict.passed) {
        if (stageIndex === payload.acceptance.stages.length - 1) {
          return new S.TaskResult({
            answer: answer.join("\n"),
            artifacts,
            usage: usage.reduce(
              (acc, u) => ({
                inputTokens: acc.inputTokens + u.inputTokens,
                outputTokens: acc.outputTokens + u.outputTokens,
              }),
              { inputTokens: 0, outputTokens: 0 },
            ),
          });
        }
        stageIndex += 1;
        continue;
      }

      // 5. failed stage → suspend for human review; the workflow resumes when
      // an external reviewer completes the deferred (or via resume()).
      const approval = DurableDeferred.make("agent/approval", {
        success: S.Approval,
      });
      const outcome = yield* DurableDeferred.await(approval);
      if (outcome._tag === "rejected") {
        return yield* new StageRejected({ stage: stage.id, reason: outcome.reason });
      }
      // approved: keep looping on the same stage with the next model step
    }

    return yield* new MaxStepsExceeded({ steps: payload.maxSteps });
  }).pipe(Effect.mapError((reason) => ActivityError.wrap(reason)));

/**
 * Registers `AgentTask` with the engine and provides `AgentTask.execute`.
 *
 * Requires the `WorkflowEngine` (use `WorkflowEngine.layerMemory` for tests /
 * local development) plus the runtime service layers: `Workspace`, `Model`,
 * and `Verifier`.
 */
export const layer: Layer.Layer<
  never,
  never,
  WorkflowEngineNS.WorkflowEngine | Workspace | Model | Verifier
> = AgentTask.toLayer((payload, executionId) => run(payload, executionId));
