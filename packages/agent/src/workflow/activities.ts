/**
 * Durable activity definitions for the agent task workflow.
 *
 * Every external side effect of the agent loop is an `Activity`: the engine
 * journals its result keyed by `(executionId, name, attempt)` and replays the
 * journal instead of re-executing on resume. This is what makes LLM calls
 * non-repeating and tool executions non-duplicating across crashes.
 *
 * The names are deterministic (they encode the step / stage index), which the
 * engine relies on: on replay the workflow body re-runs and must hit the same
 * activity names in the same order to read journaled results.
 *
 * Inputs are captured in the `execute` closure (not passed through the
 * schema); on replay the body recomputes them from previously journaled
 * results, so they are identical by construction.
 */
import { Effect } from "effect";
import { Activity as WorkflowActivity } from "effect/unstable/workflow";
import { ModelFailed, VerifyFailed, WorkspaceFailed } from "./error.ts";
import * as S from "./schema.ts";
import { Model, Verifier, Workspace, type WorkspaceHandle } from "./service.ts";

/**
 * One language model step: the call plus the collected response parts, usage,
 * and tool calls. The result is journaled, so a crashed step is never
 * re-billed.
 */
export const modelStep = (step: number, trajectory: ReadonlyArray<S.StepPart>) =>
  WorkflowActivity.make({
    name: `agent/modelStep-${step}`,
    success: S.ModelStepRecord,
    error: ModelFailed,
    execute: Effect.gen(function* () {
      const model = yield* Model;
      return yield* model.step({ step, trajectory });
    }),
  });

/**
 * One batch of tool executions in the workspace sandbox. Journaled per step,
 * so the sandbox mutations are never applied twice for the same step.
 */
export const toolBatch = (
  step: number,
  handle: WorkspaceHandle,
  calls: ReadonlyArray<S.ToolCall>,
) =>
  WorkflowActivity.make({
    name: `agent/toolBatch-${step}`,
    success: S.ToolBatchRecord,
    error: WorkspaceFailed,
    execute: Effect.gen(function* () {
      const workspace = yield* Workspace;
      return yield* workspace.runTools(handle, calls);
    }),
  });

/**
 * Commits the workspace mutations (git) and returns the commit hash. The
 * commit log is the durable checkpoint of the trajectory; on resume the
 * workspace is reconstructed from the latest commit.
 */
export const gitCheckpoint = (step: number, handle: WorkspaceHandle) =>
  WorkflowActivity.make({
    name: `agent/checkpoint-${step}`,
    success: S.CheckpointRecord,
    error: WorkspaceFailed,
    execute: Effect.gen(function* () {
      const workspace = yield* Workspace;
      return yield* workspace.checkpoint(handle, `agent step ${step}`);
    }),
  });

/**
 * Runs the current stage's acceptance criteria inside the workspace. The
 * verdict is journaled, so stage verification is never re-run on resume.
 */
export const verifyStage = (stage: string, handle: WorkspaceHandle) =>
  WorkflowActivity.make({
    name: `agent/verifyStage-${stage}`,
    success: S.StageVerdict,
    error: VerifyFailed,
    execute: Effect.gen(function* () {
      const verifier = yield* Verifier;
      return yield* verifier.verifyStage({ stage, handle });
    }),
  });
