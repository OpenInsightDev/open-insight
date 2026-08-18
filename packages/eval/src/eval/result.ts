import { Effect, Sink } from "effect";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";

export const makeResultSink = <T extends Task.AnyTask>(): Sink.Sink<
  Event.BenchResult<Task.GradeTypeOf<T>>,
  Event.EvalEvent,
  never,
  EvalError
> =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);
