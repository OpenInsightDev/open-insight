import { Schema } from "effect";
import * as Metric from "@/metric/index.ts";
import * as Task from "../task/index.ts";
import { Snapshot } from "@open-insight/core/internal";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export class TaskLoadError extends Schema.TaggedErrorClass<TaskLoadError>()("TaskLoadError", {
  cause: Schema.Defect(),
}) {}

export class TaskInitError extends Schema.TaggedErrorClass<TaskInitError>()("TaskInitError", {
  task: Task.Metadata,
  cause: Schema.Defect(),
}) {}

export class TaskExecError extends Schema.TaggedErrorClass<TaskExecError>()("TaskExecError", {
  task: Task.Metadata,
  trailIndex: NonNegativeInt,
  cause: Schema.Defect(),
}) {}

export class TaskVerifFailed extends Schema.TaggedErrorClass<TaskVerifFailed>()("TaskVerifFailed", {
  task: Task.Metadata,
  expected: Task.Grade.Result,
  actual: Task.Grade.Result,
  cause: Schema.Defect(),
}) {}

export class EventTransportInitError extends Schema.TaggedErrorClass<EventTransportInitError>()(
  "EventTransportInitError",
  {
    transport: Schema.String,
    url: Schema.String,
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
  task: Task.Metadata,
  snapshot: Snapshot.Snapshot,
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([
  InitError,
  TaskLoadError,
  EventTransportInitError,
  EventTransportError,
  SnapshotError,
  TaskInitError,
  TaskExecError,
  TaskVerifFailed,
  Metric.MetricError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("ExecError", {
  reason: ErrorReason,
}) {
  static init = (cause: unknown) => new Error({ reason: new InitError({ cause }) });

  static taskLoad = (cause: unknown) => new Error({ reason: new TaskLoadError({ cause }) });

  static eventTransportInit =
    ({ transport, url }: { transport: string; url: string }) =>
    (cause: unknown) =>
      this.make({
        reason: EventTransportInitError.make({
          transport,
          url,
          cause,
        }),
      });

  static eventTransport =
    ({ transport }: { transport: string }) =>
    (cause: unknown) =>
      this.make({
        reason: EventTransportError.make({
          transport,
          cause,
        }),
      });

  static snapshot =
    ({ task }: { task: Task.Task }) =>
    (cause: unknown) =>
      new Error({
        reason: new SnapshotError({
          task: task.metadata,
          snapshot: task.snapshot,
          cause,
        }),
      });

  static taskInit =
    ({ task }: { task: Task.Metadata }) =>
    (cause: unknown) =>
      new Error({
        reason: new TaskInitError({
          task,
          cause,
        }),
      });

  static taskExec =
    ({ task, trailIndex }: { task: Task.Metadata; trailIndex: number }) =>
    (cause: unknown) =>
      new Error({
        reason: new TaskExecError({
          task,
          trailIndex,
          cause,
        }),
      });

  static taskVerif =
    (task: Task.Metadata, expected: Task.Grade.Result, actual: Task.Grade.Result) =>
    (cause: unknown) =>
      new Error({
        reason: new TaskVerifFailed({
          task,
          expected,
          actual,
          cause,
        }),
      });

  static metric = (cause: Metric.MetricError) => new Error({ reason: cause });
}
