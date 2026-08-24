import { Prompt, Response } from "@open-insight/core/internal";
import { Stream } from "effect";
import { Tool } from "effect/unstable/ai";

export const fold = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Prompt.Prompt | Response.StreamPart<Tools>, E, R>,
): Stream.Stream<Prompt.Prompt | Response.Part<Tools>, E, R> => Response.foldPrompt(stream);
