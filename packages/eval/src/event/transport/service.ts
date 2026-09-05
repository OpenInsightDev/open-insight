import { Context, Effect, Scope, Stream } from "effect";
import type { EventError } from "../error.ts";
import type { Event } from "../schema.ts";

export type Transport = Readonly<{
  readonly send: (stream: Stream.Stream<Event>) => Effect.Effect<void, EventError, Scope.Scope>;
}>;

export class Service extends Context.Service<Service, Transport>()("eval/event/Transport") {}
