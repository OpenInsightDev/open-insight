import { Context } from "effect";
import { Effect, type Scope } from "effect";
import type { EventError } from "../error.ts";
import type { EventStream } from "../queue.ts";

export type Transport = Readonly<{
  send(stream: EventStream): Effect.Effect<void, EventError, Scope.Scope>;
}>;

export class Service extends Context.Service<Service, Transport>()("event/Transport") {}
