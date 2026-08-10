/**
 * Runtime contracts the durable agent workflow requires.
 *
 * These are the *non-durable* capabilities the workflow body needs. The
 * durable loop wraps every call in an `Activity` (see `activities.ts`), so on
 * crash-replay the engine returns journaled results instead of re-invoking
 * these services.
 *
 * Contracts:
 *
 * - `Workspace.acquire` is keyed by `executionId` and MUST be idempotent on
 *   replay: a production implementation reconstructs the workspace (e.g. from
 *   the last durable git checkpoint) instead of creating a fresh one.
 * - `Workspace.checkpoint` commits the workspace mutations (git) and returns
 *   the commit hash, which becomes the durable checkpoint of the trajectory.
 * - `Model.step` receives the folded trajectory so far; its result is
 *   journaled and drives the next step deterministically.
 */
import type * as S from "./schema.ts";
import type { ModelFailed, VerifyFailed, WorkspaceFailed } from "./error.ts";
import { Context, Effect } from "effect";

/**
 * Opaque handle to one task's workspace (sandbox + git worktree). Carries the
 * execution id so implementations can key the workspace by the durable
 * execution.
 */
export type WorkspaceHandle = Readonly<{
  readonly executionId: string;
  readonly spec: S.SandboxSpec;
}>;

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly acquire: (options: {
      readonly executionId: string;
      readonly spec: S.SandboxSpec;
    }) => Effect.Effect<WorkspaceHandle, WorkspaceFailed>;

    readonly release: (handle: WorkspaceHandle) => Effect.Effect<void, WorkspaceFailed>;

    readonly runTools: (
      handle: WorkspaceHandle,
      calls: ReadonlyArray<S.ToolCall>,
    ) => Effect.Effect<S.ToolBatchRecord, WorkspaceFailed>;

    readonly checkpoint: (
      handle: WorkspaceHandle,
      message: string,
    ) => Effect.Effect<S.CheckpointRecord, WorkspaceFailed>;
  }
>()("open-insight/Activity/Workspace") {}

export class Model extends Context.Service<
  Model,
  {
    readonly step: (options: {
      readonly step: number;
      readonly trajectory: ReadonlyArray<S.StepPart>;
    }) => Effect.Effect<S.ModelStepRecord, ModelFailed>;
  }
>()("open-insight/Activity/Model") {}

export class Verifier extends Context.Service<
  Verifier,
  {
    readonly verifyStage: (options: {
      readonly stage: string;
      readonly handle: WorkspaceHandle;
    }) => Effect.Effect<S.StageVerdict, VerifyFailed>;
  }
>()("open-insight/Activity/Verifier") {}
