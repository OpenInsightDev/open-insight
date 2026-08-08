import { Effect, Schema, Stream } from "effect";
import type { EvalEventEncoded } from "./schema.ts";
import { EvalEvent } from "./schema.ts";
import { EventError } from "./error.ts";
import { Prompt } from "@open-insight/core/internal";

/**
 * Builds the `EvalEvent` schema for an encoded event, deriving the toolkit from
 * the tool name observed on each `TrailStreamEvent` part (via the shared
 * `Prompt.partToolkit`) so that arbitrarily named tool calls/results decode
 * without a pre-declared toolkit.
 */
const eventSchema = (encoded: EvalEventEncoded) =>
  encoded._tag === "TrailStreamEvent"
    ? EvalEvent(Prompt.partToolkit(encoded.part))
    : EvalEvent(Prompt.emptyToolkit);

/**
 * Decodes an encoded event stream into typed events, constructing the `EvalEvent`
 * schema's toolkit dynamically from the tool name observed on each `TrailStreamEvent`
 * part. Decode failures and upstream errors are normalized to `EventError`.
 */
export const decodeStream = Effect.fn(
  function* <E, R>(
    stream: Stream.Stream<EvalEventEncoded, E, R>,
  ): Effect.fn.Return<Stream.Stream<EvalEvent, EventError, R>> {
    return yield* Effect.succeed(
      stream.pipe(
        Stream.mapEffect((encoded) => Schema.decodeUnknownEffect(eventSchema(encoded))(encoded)),
        Stream.mapError(EventError.invalid),
      ),
    );
  },
  (effect) => effect.pipe(Stream.unwrap),
);
