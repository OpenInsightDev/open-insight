import { Effect, Schema, Scope } from "effect";
import type { EventTransport } from "@/exec/event/index.ts";
import { ExecError } from "@/exec/error.ts";
import { type Event, EventSchema } from "@/exec/event/schema.ts";

const transport = "log";

const serializeEvent = Schema.encodeUnknownEffect(EventSchema);

const logEvent = Effect.fn(function* (event: Event) {
  const serialized = yield* serializeEvent(event).pipe(
    Effect.mapError(ExecError.eventTransport({ transport })),
  );

  yield* Effect.logDebug(JSON.stringify(serialized));
});

export const make = Effect.fn(function* () {
  return {
    send: Effect.fn(function* ({ stream }): Effect.fn.Return<void, ExecError, Scope.Scope> {
      throw new Error("Not implemented");
    }),
  } satisfies EventTransport;
});
