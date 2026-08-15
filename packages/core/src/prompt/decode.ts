import { Schema, Stream, type Effect } from "effect";
import { Response } from "effect/unstable/ai";
import { AnyStreamPart } from "./schema.ts";

// /**
//  * Decodes a single encoded stream part (`Response.StreamPartEncoded`) into its
//  * typed form, building a permissive toolkit from the tool name observed on each
//  * `tool-call`/`tool-result` part.
//  */
export const decodeResponseStreamPartEncoded = (
  encoded: Response.StreamPartEncoded,
): Effect.Effect<AnyStreamPart, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(AnyStreamPart)(encoded);

// /**
//  * Decodes a stream of encoded response stream parts
//  * (`Response.StreamPartEncoded`) into typed stream parts, one per event.
//  */
export const decodeResponseStream = <E, R>(
  stream: Stream.Stream<Response.StreamPartEncoded, E, R>,
): Stream.Stream<AnyStreamPart, E | Schema.SchemaError, R> =>
  stream.pipe(Stream.mapEffect(decodeResponseStreamPartEncoded));

/**
 * Encodes a typed stream part (`AnyStreamPart`) back into its encoded wire
 * form (`Response.StreamPartEncoded`), the inverse of
 * {@link decodeResponseStreamPartEncoded}.
 */
export const encodeResponseStreamPartEncoded = (
  part: AnyStreamPart,
): Effect.Effect<Response.StreamPartEncoded, Schema.SchemaError> =>
  Schema.encodeUnknownEffect(AnyStreamPart)(part);
