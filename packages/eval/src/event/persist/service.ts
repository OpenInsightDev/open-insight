import { Context, Effect, Option, Stream } from "effect";
import { BenchID, EvalErrorEvent, EvalSuccessEvent, TaskID, TrailID } from "../schema.ts";
import type { EventError } from "../error.ts";
import type { BenchResult, ResultDone, TaskResult, TrailResult } from "../result.ts";
import { EvalEvent } from "../schema.ts";

type EventStream<R> = Stream.Stream<EvalSuccessEvent, EventError | EvalErrorEvent | ResultDone<R>>;

export type Persist = Readonly<{
  getBench(id: BenchID): Option.Option<EventStream<BenchResult>>;
  getTask(id: TaskID): Option.Option<EventStream<TaskResult>>;
  getTrail(id: TrailID): Option.Option<EventStream<TrailResult>>;

  persist<E, R>(stream: Stream.Stream<EvalEvent, E, R>): Effect.Effect<void, EventError | E, R>;
}>;

// TODO add a git-based default impl

/** Provides the event stream persistence sink. */
export class Service extends Context.Service<Service, Persist>()("event/Persist") {}
