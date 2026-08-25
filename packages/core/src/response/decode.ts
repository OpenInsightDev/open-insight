import { Effect, Schema } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import { Response } from "@open-insight/core/internal";

export const decodeStreamPartView =
  <Curr extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Curr>) =>
  <Prev extends Record<string, Tool.Any>>(part: Response.StreamPartView<Prev>) => {
    const encode = Schema.encodeEffect(Response.StreamPartView(Toolkit.empty));
    const decode = Schema.decodeEffect(Response.StreamPartView(toolkit));

    if (part.type !== "tool-call" && part.type !== "tool-result") {
      return Effect.succeed(part);
    }
    const toolNames = new Set(Object.values(toolkit.tools).map((tool) => tool.name));
    if (!toolNames.has(part.name)) {
      return Effect.succeed(part);
    }

    return Effect.succeed(part).pipe(Effect.flatMap(encode), Effect.flatMap(decode));
  };

export const decodePartView =
  <Curr extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Curr>) =>
  <Prev extends Record<string, Tool.Any>>(part: Response.Part<Prev>) => {
    const encode = Schema.encodeEffect(Response.PartView(Toolkit.empty));
    const decode = Schema.decodeEffect(Response.PartView(toolkit));

    if (part.type !== "tool-call" && part.type !== "tool-result") {
      return Effect.succeed(part);
    }
    const toolNames = new Set(Object.values(toolkit.tools).map((tool) => tool.name));
    if (!toolNames.has(part.name)) {
      return Effect.succeed(part);
    }

    return Effect.succeed(part).pipe(Effect.flatMap(encode), Effect.flatMap(decode));
  };
