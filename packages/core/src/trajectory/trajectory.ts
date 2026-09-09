import { DateTime, Effect, Encoding, Match, Result, Schema, Stream, Tuple } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import * as uuid from "uuid";
import type { TrajectoryError } from "./error.ts";

export const PromptPart = Schema.TaggedStruct("Prompt", {
  messages: Schema.Array(Prompt.Message),
});
export type PromptPart = Schema.Schema.Type<typeof PromptPart>;
export type PromptPartEncoded = Schema.Codec.Encoded<typeof PromptPart>;

const Timestamp = Schema.DateTimeUtcFromString.pipe(Schema.withConstructorDefault(DateTime.now));
export const ResponsePart = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.TaggedStruct("Response", {
    response: Response.PartView(toolkit),
    timestamp: Timestamp,
  });
export type ResponsePart<T extends Toolkit.Any> = Schema.Schema.Type<
  ReturnType<typeof ResponsePart<T>>
>;
export type ResponsePartEncoded = Schema.Codec.Encoded<ReturnType<typeof ResponsePart<any>>>;

const Uuid = Schema.String.check(Schema.isUUID(7)).pipe(
  Schema.withConstructorDefault(Effect.succeed(uuid.v7())),
);
export const PartMetadata = Schema.Struct({
  uuid: Uuid,
  session: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Json),
});
export type PartMetadata = Schema.Schema.Type<typeof PartMetadata>;

export const Part = <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
  Schema.Union([PromptPart, ResponsePart(toolkit)]).mapMembers(
    Tuple.map(Schema.fieldsAssign(PartMetadata.fields)),
  );
export type Part<Tools extends Record<string, Tool.Any>> = Schema.Schema.Type<
  ReturnType<typeof Part<Tools>>
>;
export type PartEncoded = Schema.Codec.Encoded<ReturnType<typeof Part<any>>>;

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  Part<Tools>,
  TrajectoryError
> &
  Readonly<{ toolkit: Toolkit.Toolkit<Tools> }>;
export type Any = Trajectory<Record<string, never>>;
export type TrajectoryEncoded = Stream.Stream<PartEncoded, TrajectoryError>;
