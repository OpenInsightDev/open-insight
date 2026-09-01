import { Effect, Schema } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import { Response } from "@open-insight/core/internal";

export const decodeStreamPartView =
  <Curr extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Curr>) =>
  <Prev extends Record<string, Tool.Any>>(part: Response.StreamPartView<Prev>) =>
    Effect.gen(function* () {
      if (part.type !== "tool-call" && part.type !== "tool-result") {
        return part;
      }
      const toolNames = new Set(Object.values(toolkit.tools).map((tool) => tool.name));
      if (!toolNames.has(part.name)) {
        return part;
      }

      const encoded = yield* Schema.encodeEffect(Response.StreamPartView(Toolkit.empty))(part);
      return yield* Schema.decodeEffect(Response.StreamPartView(toolkit))(encoded);
    });

export const decodePartView =
  <Curr extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Curr>) =>
  <Prev extends Record<string, Tool.Any>>(part: Response.PartView<Prev>) =>
    Effect.gen(function* () {
      if (part.type !== "tool-call" && part.type !== "tool-result") {
        return part;
      }
      const toolNames = new Set(Object.values(toolkit.tools).map((tool) => tool.name));
      if (!toolNames.has(part.name)) {
        return part;
      }

      const encoded = yield* Schema.encodeEffect(Response.PartView(Toolkit.empty))(part);
      return yield* Schema.decodeEffect(Response.PartView(toolkit))(encoded);
    });
