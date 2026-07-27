import { Schema, type Stream } from "effect";
import { Prompt, type Response } from "effect/unstable/ai";

export const Trajectory = Prompt.Prompt;
export type Trajectory = Schema.Schema.Type<typeof Trajectory>;

// HACK for some reason effect does not export a Part schema union
export const PartDecoded = Schema.Union([
  Prompt.TextPart,
  Prompt.ReasoningPart,
  Prompt.FilePart,
  Prompt.ToolCallPart,
  Prompt.ToolResultPart,
  Prompt.ToolApprovalResponsePart,
  Prompt.ToolApprovalRequestPart,
]) satisfies Schema.Codec<Prompt.Part, Prompt.PartEncoded>;

export type Parts = ReadonlyArray<Prompt.Part>;
export type RespParts = ReadonlyArray<Response.AnyPart>;

export type RespPartStream<E, R> = Stream.Stream<Response.AnyPart, E, R>;
export type PartStream<E, R> = Stream.Stream<Prompt.Part, E, R>;
export type PartEncodedStream<E, R> = Stream.Stream<Prompt.PartEncoded, E, R>;

export * from "effect/unstable/ai/Prompt";
