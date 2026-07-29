import { Schema } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Tasks from "#/tasks/index.ts";
import * as Task from "../task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import * as Event from "#/event/index.ts";
import { Agent, Prompt, Snapshot } from "@open-insight/core/internal";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
type ExecTask = Task.Task<Grade.Result, object>;

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export class TaskInitError extends Schema.TaggedErrorClass<TaskInitError>()("TaskInitError", {
  task: Task.ID,
  cause: Schema.Defect(),
}) {}

export class TaskExecError extends Schema.TaggedErrorClass<TaskExecError>()("TaskExecError", {
  task: Task.ID,
  trailIdx: NonNegativeInt,
  cause: Schema.Defect(),
}) {}

export class TaskVerifExecError extends Schema.TaggedErrorClass<TaskVerifExecError>()(
  "TaskVerifExecError",
  {
    task: Task.ID,
    cause: Schema.Defect(),
  },
) {}

export class MissingVerifier extends Schema.TaggedErrorClass<MissingVerifier>()("MissingVerifier", {
  task: Task.ID,
  stages: Schema.Array(Schema.String),
}) {}

export class VerifMismatch extends Schema.TaggedErrorClass<VerifMismatch>()("VerifMismatch", {
  task: Task.ID,
  expect: Grade.Result,
  actual: Schema.Union([Grade.Result, Prompt.Prompt]),
}) {}

export class VerifInitialMatch extends Schema.TaggedErrorClass<VerifInitialMatch>()(
  "VerifInitialMatch",
  {
    task: Task.ID,
    expect: Grade.Result,
  },
) {}

export class SnapshotError extends Schema.TaggedErrorClass<SnapshotError>()("SnapshotError", {
  task: Task.ID,
  snapshot: Snapshot.Snapshot,
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([
  InitError,
  Tasks.Error,
  Event.Error,
  Agent.Error,
  Grade.Error,
  SnapshotError,
  TaskInitError,
  TaskExecError,
  MissingVerifier,
  VerifMismatch,
  VerifInitialMatch,
  TaskVerifExecError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("EvalError", {
  reason: ErrorReason,
  benchmark: Schema.optional(Bench.Metadata),
  harness: Schema.optional(Harness.Metadata),
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static init = this.mapUnknownError((cause) => new InitError({ cause }));

  static tasks = (cause: Tasks.Error) => new Error({ reason: cause });

  static event = (cause: Event.Error) => new Error({ reason: cause });

  static grade = (cause: Grade.Error) => new Error({ reason: cause });

  static snapshot = (task: ExecTask) =>
    this.mapUnknownError(
      (cause) => new SnapshotError({ task: task.metadata.id, snapshot: task.snapshot, cause }),
    );

  static taskInit = (task: ExecTask) =>
    this.mapUnknownError((cause) => new TaskInitError({ task: task.metadata.id, cause }));

  static taskExec = (task: ExecTask, trailIdx: number) =>
    this.mapUnknownError((cause) => new TaskExecError({ task: task.metadata.id, trailIdx, cause }));

  static missingVerifier = (task: ExecTask, stages: string[]) =>
    new Error({
      reason: new MissingVerifier({ task: task.metadata.id, stages }),
    });

  static verifMismatch = (
    task: ExecTask,
    expect: Grade.Result,
    actual: Grade.Result | Prompt.Prompt,
  ) => new Error({ reason: new VerifMismatch({ task: task.metadata.id, expect, actual }) });

  static verifInitialMatch = (task: ExecTask, expect: Grade.Result) =>
    new Error({ reason: new VerifInitialMatch({ task: task.metadata.id, expect }) });

  static verifExec = (task: ExecTask) =>
    this.mapUnknownError((cause) => new TaskVerifExecError({ task: task.metadata.id, cause }));

  static agent = (error: Agent.Error) => new Error({ reason: error });
}
