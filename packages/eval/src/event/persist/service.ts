import { Cause, Context, Effect, Stream } from "effect";
import { BenchID, TaskID, TrailID } from "../schema.ts";
import type { EventError } from "../error.ts";
import type { BenchResult, TaskResult, TrailResult } from "../result.ts";
import { EvalEvent } from "../schema.ts";

export type Persist = Readonly<{
  getBench(id: BenchID): Stream.Stream<EvalEvent, EventError | Cause.Done<BenchResult>>;
  getTask(id: TaskID): Stream.Stream<EvalEvent, EventError | Cause.Done<TaskResult>>;
  getTrail(id: TrailID): Stream.Stream<EvalEvent, EventError | Cause.Done<TrailResult>>;

  persist(stream: Stream.Stream<EvalEvent, EventError>): Effect.Effect<void, EventError>;
}>;

/** Provides the event stream persistence sink. */
export class Service extends Context.Service<Service, Persist>()("event/Persist") {}
