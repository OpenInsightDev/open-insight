import { Schema } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Tasks from "#/tasks/index.ts";
import * as Task from "../task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import { Snapshot } from "@open-insight/core/internal";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
type ExecTask = Task.Task<Grade.Result, Schema.JsonObject>;

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
  stage: Schema.String,
}) {}

export class TaskVerifFailed extends Schema.TaggedErrorClass<TaskVerifFailed>()("TaskVerifFailed", {
  task: Task.ID,
  expect: Grade.Result,
  actual: Grade.Result,
  cause: Schema.Defect(),
}) {}

export class EventTransportInitError extends Schema.TaggedErrorClass<EventTransportInitError>()(
  "EventTransportInitError",
  {
    transport: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class EventTransportError extends Schema.TaggedErrorClass<EventTransportError>()(
  "EventTransportError",
  {
    transport: Schema.String,
    cause: Schema.Defect(),
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
  EventTransportInitError,
  EventTransportError,
  SnapshotError,
  TaskInitError,
  TaskExecError,
  MissingVerifier,
  TaskVerifFailed,
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

  static eventTransportInit = (transport: string) =>
    this.mapUnknownError((cause) => new EventTransportInitError({ transport, cause }));

  static eventTransport = (transport: string) =>
    this.mapUnknownError((cause) => new EventTransportError({ transport, cause }));

  static snapshot = (task: ExecTask) =>
    this.mapUnknownError(
      (cause) => new SnapshotError({ task: task.metadata.id, snapshot: task.snapshot, cause }),
    );

  static taskInit = (task: ExecTask) =>
    this.mapUnknownError((cause) => new TaskInitError({ task: task.metadata.id, cause }));

  static taskExec = (task: ExecTask, trailIdx: number) =>
    this.mapUnknownError((cause) => new TaskExecError({ task: task.metadata.id, trailIdx, cause }));

  static missingVerifier = (task: ExecTask, stage: string) =>
    new Error({
      reason: new MissingVerifier({ task: task.metadata.id, stage }),
    });

  static taskVerif = (task: ExecTask, expect: Grade.Result, actual: Grade.Result) =>
    this.mapUnknownError(
      (cause) => new TaskVerifFailed({ task: task.metadata.id, expect, actual, cause }),
    );

  static taskVerifExec = (task: ExecTask) =>
    this.mapUnknownError((cause) => new TaskVerifExecError({ task: task.metadata.id, cause }));
}
