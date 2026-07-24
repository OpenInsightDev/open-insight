import { Context, Effect, type Scope } from "effect";
import type { EventStream } from "./schema.ts";
import type { Error } from "../error.ts";

export type EventTransport = Readonly<{
  send(stream: EventStream): Effect.Effect<void, Error, Scope.Scope>;
}>;

export class EventTransportService extends Context.Service<EventTransportService, EventTransport>()(
  "exec/EventTransportService",
) {}
