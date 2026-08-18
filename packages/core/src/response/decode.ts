import { Schema, Stream, type Effect } from "effect";
import { AnyStreamPart } from "./schema.ts";
import type { StreamPartEncoded } from "effect/unstable/ai/Response";
import { Chat } from "effect/unstable/ai";

export const decodeStreamPartEncoded = (
  encoded: StreamPartEncoded,
): Effect.Effect<AnyStreamPart, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(AnyStreamPart)(encoded);

export const decodeStream = <E, R>(
  stream: Stream.Stream<StreamPartEncoded, E, R>,
): Stream.Stream<AnyStreamPart, E | Schema.SchemaError, R> =>
  stream.pipe(Stream.mapEffect(decodeStreamPartEncoded));

export const encodeStreamPart = (
  part: AnyStreamPart,
): Effect.Effect<StreamPartEncoded, Schema.SchemaError> =>
  Schema.encodeUnknownEffect(AnyStreamPart)(part);

Chat.Chat;
