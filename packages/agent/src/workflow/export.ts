/**
 * Public exports for the `activity` module.
 *
 * `activity` models the process of an agent executing a task as a durable
 * workflow (`effect/unstable/workflow`): `AgentTask` drives the agent loop as
 * deterministic orchestration over journaled activities, with git checkpoints
 * as the durable trajectory, acceptance-DAG stage verification, and
 * suspend/resume for human review.
 */
export { AgentTask, layer } from "./workflow.ts";
export { TaskInput, TaskResult, Approval, StepPart, ToolCall, ModelStepRecord } from "./schema.ts";
export {
  ActivityError,
  ErrorReason,
  MaxStepsExceeded,
  StageRejected,
  WorkspaceFailed,
  ModelFailed,
  VerifyFailed,
} from "./error.ts";
export { Workspace, Model, Verifier, type WorkspaceHandle } from "./service.ts";

export * as Internal from "./index.ts";
