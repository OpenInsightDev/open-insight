import { Schema } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Tasks from "#/tasks/index.ts";
import * as Task from "../task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import { Agent, Snapshot, Harness } from "@open-insight/core/internal";

const Cause = Schema.Error();
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
type ExecTask = Task.AnyTask;

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize evaluation: ${this.cause.message}`;
  }
}

export class TaskInitError extends Schema.TaggedErrorClass<TaskInitError>()("TaskInitError", {
  task: Task.ID,
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize task "${this.task}": ${this.cause.message}`;
  }
}

export class TaskExecError extends Schema.TaggedErrorClass<TaskExecError>()("TaskExecError", {
  task: Task.ID,
  trailIdx: NonNegativeInt,
  cause: Cause,
}) {
  override get message(): string {
    return `Task "${this.task}" trail ${this.trailIdx} failed: ${this.cause.message}`;
  }
}

export class TaskVerifExecError extends Schema.TaggedErrorClass<TaskVerifExecError>()(
  "TaskVerifExecError",
  {
    task: Task.ID,
    cause: Cause,
  },
) {
  override get message(): string {
    return `Task "${this.task}" verification execution failed: ${this.cause.message}`;
  }
}

export class MissingVerifier extends Schema.TaggedErrorClass<MissingVerifier>()("MissingVerifier", {
  task: Task.ID,
  stages: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Task "${this.task}" is missing verifiers for stages: ${this.stages.join(", ")}`;
  }
}

export class VerifMismatch extends Schema.TaggedErrorClass<VerifMismatch>()("VerifMismatch", {
  task: Task.ID,
  expect: Schema.Unknown,
  actual: Schema.Unknown,
}) {
  override get message(): string {
    return `Task "${this.task}" verification result does not match the expected grade`;
  }
}

export class VerifInitialMatch extends Schema.TaggedErrorClass<VerifInitialMatch>()(
  "VerifInitialMatch",
  {
    task: Task.ID,
    expect: Schema.Unknown,
  },
) {
  override get message(): string {
    return `Task "${this.task}" already matches the expected grade before verification`;
  }
}

export class SnapshotError extends Schema.TaggedErrorClass<SnapshotError>()("SnapshotError", {
  task: Task.ID,
  snapshot: Snapshot.Snapshot,
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to prepare snapshot for task "${this.task}": ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([
  InitError,
  Tasks.Error,
  Event.Error,
  Grade.Error,
  Harness.Error,
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
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static mapUnknownError = (mapper: (cause: globalThis.Error) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error
      ? cause
      : new Error({ reason: mapper(Schema.decodeUnknownSync(Cause)(cause)) });

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

  static verifMismatch = (task: ExecTask, expect: Grade.Result["Encoded"], actual: unknown) =>
    new Error({ reason: new VerifMismatch({ task: task.metadata.id, expect, actual }) });

  static verifInitialMatch = (task: ExecTask, expect: Grade.Result["Encoded"]) =>
    new Error({ reason: new VerifInitialMatch({ task: task.metadata.id, expect }) });

  static verifExec = (task: ExecTask) =>
    this.mapUnknownError((cause) => new TaskVerifExecError({ task: task.metadata.id, cause }));

  static harness = (cause: Harness.Error) => new Error({ reason: cause });
}
