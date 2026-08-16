import { Context, Stream } from "effect";
import { Effect, type Scope } from "effect";
import type { EventError } from "../error.ts";
import type { EvalEvent } from "../schema.ts";

export type Transport = Readonly<{
  send(stream: Stream.Stream<EvalEvent>): Effect.Effect<void, EventError, Scope.Scope>;
}>;

export class Service extends Context.Service<Service, Transport>()("event/Transport") {}
