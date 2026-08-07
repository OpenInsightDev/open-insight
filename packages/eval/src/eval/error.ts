import { Formatter, Schema } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Tasks from "#/tasks/index.ts";
import * as Task from "#/task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import { Agent, Harness, Snapshot, Utils } from "@open-insight/core/internal";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
type ExecTask = Task.AnyTask;

/** The evaluation could not be initialized. */
export class InitFailed extends Schema.TaggedError<InitFailed>(
  "open-insight/eval/EvalError/InitFailed",
)("InitFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to initialize evaluation: ${Formatter.format(this.cause)}`;
  }
}

/** A task could not be initialized for the evaluation run. */
export class TaskInitFailed extends Schema.TaggedError<TaskInitFailed>(
  "open-insight/eval/EvalError/TaskInitFailed",
)("TaskInitFailed", {
  task: Task.ID,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to initialize task "${this.task}": ${Formatter.format(this.cause)}`;
  }
}

/** An evaluation trail failed while executing a task stage. */
export class TaskExecFailed extends Schema.TaggedError<TaskExecFailed>(
  "open-insight/eval/EvalError/TaskExecFailed",
)("TaskExecFailed", {
  task: Task.ID,
  trailIdx: NonNegativeInt,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Task "${this.task}" trail ${this.trailIdx} failed: ${Formatter.format(this.cause)}`;
  }
}

/** A task's verification execution failed. */
export class VerifExecFailed extends Schema.TaggedError<VerifExecFailed>(
  "open-insight/eval/EvalError/VerifExecFailed",
)("VerifExecFailed", {
  task: Task.ID,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Task "${this.task}" verification execution failed: ${Formatter.format(this.cause)}`;
  }
}

/** A task does not declare verifiers for stages that require verification. */
export class MissingVerifier extends Schema.TaggedError<MissingVerifier>(
  "open-insight/eval/EvalError/MissingVerifier",
)("MissingVerifier", {
  task: Task.ID,
  stages: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Task "${this.task}" is missing verifiers for stages: ${this.stages.join(", ")}`;
  }
}

/** A verification run produced a result that does not match the expected grade. */
export class VerifMismatch extends Schema.TaggedError<VerifMismatch>(
  "open-insight/eval/EvalError/VerifMismatch",
)("VerifMismatch", {
  task: Task.ID,
  expect: Schema.Unknown,
  actual: Schema.Unknown,
}) {
  override get message(): string {
    return `Task "${this.task}" verification result does not match the expected grade`;
  }
}

/** A task already matches the expected grade before verification runs. */
export class VerifInitialMatch extends Schema.TaggedError<VerifInitialMatch>(
  "open-insight/eval/EvalError/VerifInitialMatch",
)("VerifInitialMatch", {
  task: Task.ID,
  expect: Schema.Unknown,
}) {
  override get message(): string {
    return `Task "${this.task}" already matches the expected grade before verification`;
  }
}

/** A task snapshot could not be prepared. */
export class SnapshotFailed extends Schema.TaggedError<SnapshotFailed>(
  "open-insight/eval/EvalError/SnapshotFailed",
)("SnapshotFailed", {
  task: Task.ID,
  snapshot: Snapshot.Snapshot,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to prepare snapshot for task "${this.task}": ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([
  InitFailed,
  Utils.Git.GitError,
  Agent.AgentError,
  Tasks.TasksError,
  Event.EventError,
  Grade.GradeError,
  Harness.HarnessError,
  SnapshotFailed,
  TaskInitFailed,
  TaskExecFailed,
  MissingVerifier,
  VerifMismatch,
  VerifInitialMatch,
  VerifExecFailed,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by evaluation runs. */
export class EvalError extends Schema.TaggedError<EvalError>("open-insight/eval/EvalError")(
  "EvalError",
  {
    reason: ErrorReason,
    benchmark: Schema.optionalKey(Bench.Metadata),
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static init = (cause: unknown): EvalError =>
    EvalError.make({ reason: InitFailed.make({ cause }) });

  static git = (cause: Utils.Git.GitError): EvalError => EvalError.make({ reason: cause });

  static agent = (cause: Agent.AgentError): EvalError => EvalError.make({ reason: cause });

  static tasks = (cause: Tasks.TasksError): EvalError => EvalError.make({ reason: cause });

  static event = (cause: Event.EventError): EvalError => EvalError.make({ reason: cause });

  static grade = (cause: Grade.GradeError): EvalError => EvalError.make({ reason: cause });

  static harness = (cause: Harness.HarnessError): EvalError => EvalError.make({ reason: cause });

  static snapshot =
    (task: ExecTask) =>
    (cause: unknown): EvalError =>
      EvalError.make({
        reason: SnapshotFailed.make({ task: task.metadata.id, snapshot: task.snapshot, cause }),
      });

  static taskInit =
    (task: ExecTask) =>
    (cause: unknown): EvalError =>
      EvalError.make({ reason: TaskInitFailed.make({ task: task.metadata.id, cause }) });

  static taskExec =
    (task: ExecTask, trailIdx: number) =>
    (cause: unknown): EvalError =>
      EvalError.make({ reason: TaskExecFailed.make({ task: task.metadata.id, trailIdx, cause }) });

  static missingVerifier = (task: ExecTask, stages: string[]): EvalError =>
    EvalError.make({ reason: MissingVerifier.make({ task: task.metadata.id, stages }) });

  static verifMismatch = (
    task: ExecTask,
    expect: Grade.Result["Encoded"],
    actual: unknown,
  ): EvalError =>
    EvalError.make({ reason: VerifMismatch.make({ task: task.metadata.id, expect, actual }) });

  static verifInitialMatch = (task: ExecTask, expect: Grade.Result["Encoded"]): EvalError =>
    EvalError.make({ reason: VerifInitialMatch.make({ task: task.metadata.id, expect }) });

  static verifExec =
    (task: ExecTask) =>
    (cause: unknown): EvalError =>
      EvalError.make({ reason: VerifExecFailed.make({ task: task.metadata.id, cause }) });
}
