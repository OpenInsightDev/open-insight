import { Schema } from "effect";
import * as Metric from "@/metric/index.ts";
import * as Task from "../task/index.ts";
import { Sandbox } from "@open-insight/core/internal";

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
  snapshot: Sandbox.Snapshot.Snapshot,
  cause: Schema.Defect(),
}) {}

export const ExecErrorReason = Schema.Union([
  InitError,
  TaskLoadError,
  EventTransportInitError,
  EventTransportError,
  SnapshotError,
  TaskInitError,
  TaskExecError,
  Metric.MetricError,
]);

export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  reason: ExecErrorReason,
}) {
  static init = (cause: unknown) => new ExecError({ reason: new InitError({ cause }) });

  static taskLoad = (cause: unknown) => new ExecError({ reason: new TaskLoadError({ cause }) });

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
      new ExecError({
        reason: new SnapshotError({
          task: task.metadata,
          snapshot: task.snapshot,
          cause,
        }),
      });

  static taskInit =
    ({ task }: { task: Task.Metadata }) =>
    (cause: unknown) =>
      new ExecError({
        reason: new TaskInitError({
          task,
          cause,
        }),
      });

  static taskExec =
    ({ task, trailIndex }: { task: Task.Metadata; trailIndex: number }) =>
    (cause: unknown) =>
      new ExecError({
        reason: new TaskExecError({
          task,
          trailIndex,
          cause,
        }),
      });

  static metric = (cause: Metric.MetricError) => new ExecError({ reason: cause });
}
