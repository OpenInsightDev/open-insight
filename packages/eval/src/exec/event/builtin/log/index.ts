import { Effect, Schema, Scope } from "effect";
import type { EventTransport } from "@/exec/event/index.ts";
import { ExecError } from "@/exec/error.ts";
import { type Event, EventSchema, type EventStream } from "@/exec/event/schema.ts";

const transport = "log";

const serializeEvent = Schema.encodeUnknownEffect(EventSchema);

const logEvent = Effect.fn(function* (event: Event) {
  const serialized = yield* serializeEvent(event).pipe(
    Effect.mapError(ExecError.eventTransport({ transport })),
  );

  yield* Effect.logDebug(JSON.stringify(serialized));
});

export const make = Effect.sync(
  (): EventTransport => ({
    create: Effect.fn(function* ({
      stream,
    }: Readonly<{ stream: EventStream }>): Effect.fn.Return<void, ExecError, Scope.Scope> {
      const scope = yield* Scope.Scope;

      throw new Error("Not implemented");
    }),
  }),
);
