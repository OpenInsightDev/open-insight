import { Context, Effect, type Scope } from "effect";
import type { EventStream } from "./schema.ts";
import type { ExecError } from "../error.ts";

export type EventTransport = Readonly<{
  send(options: Readonly<{ stream: EventStream }>): Effect.Effect<void, ExecError, Scope.Scope>;
}>;

export class EventTransportService extends Context.Service<EventTransportService, EventTransport>()(
  "exec/EventTransportService",
) {}
