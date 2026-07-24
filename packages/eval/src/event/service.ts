import { Context, Effect, type Scope } from "effect";
import type { Error } from "./error.ts";
import type { EventStream } from "./schema.ts";

export type EventTransport = Readonly<{
  send(stream: EventStream): Effect.Effect<void, Error, Scope.Scope>;
}>;

export class EventTransportService extends Context.Service<EventTransportService, EventTransport>()(
  "exec/EventTransportService",
) {}
