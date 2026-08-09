import { Effect, Schema, Stream } from "effect";
import type { EvalEventEncoded } from "./schema.ts";
import { EvalEvent } from "./schema.ts";
import { EventError } from "./error.ts";

/**
 * Decodes an encoded event stream into typed events using the `EvalEvent`
 * schema. The schema's `TrailStreamEvent` part is `Prompt.AnyStreamPart`, which
 * decodes arbitrarily-named tool call/result parts without a pre-declared
 * toolkit, so no per-event schema construction is required. Decode failures and
 * upstream errors are normalized to `EventError`.
 */
export const decodeStream = Effect.fn(
  function* <E, R>(
    stream: Stream.Stream<EvalEventEncoded, E, R>,
  ): Effect.fn.Return<Stream.Stream<EvalEvent, EventError, R>> {
    return yield* Effect.succeed(
      stream.pipe(
        Stream.mapEffect((encoded) => Schema.decodeUnknownEffect(EvalEvent)(encoded)),
        Stream.mapError(EventError.invalid),
      ),
    );
  },
  (effect) => effect.pipe(Stream.unwrap),
);
