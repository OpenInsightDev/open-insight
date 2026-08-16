import { Data, Match, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { AnyPart, type AnyStreamPart } from "./schema.ts";

type AccumState = Data.TaggedEnum<{
  Idle: {}
  Text: { readonly id: string; readonly text: string }
  Reasoning: { readonly id: string; readonly text: string }
  ToolParams: {
    readonly id: string
    readonly name: string
    readonly providerExecuted: boolean
    readonly deltas: string
  }
}>;

const { Idle, Text, Reasoning, ToolParams, $match } = Data.taggedEnum<AccumState>();

const matchPart = (state: AccumState, part: AnyStreamPart): readonly [AccumState, readonly AnyPart[]] =>
  $match(state, {
    Idle: () =>
      Match.value(part).pipe(
        Match.when({ type: "text-start" as const }, (p) => [Text({ id: p.id, text: "" }), []] as const),
        Match.when({ type: "reasoning-start" as const }, (p) => [Reasoning({ id: p.id, text: "" }), []] as const),
        Match.when({ type: "tool-params-start" as const }, (p) => [
          ToolParams({ id: p.id, name: p.name, providerExecuted: p.providerExecuted, deltas: "" }),
          [],
        ] as const),
        Match.orElse(() => [state, [part]] as const),
      ),

    Text: (s) =>
      Match.value(part).pipe(
        Match.when({ type: "text-delta" as const }, (p) => [Text({ ...s, text: s.text + p.delta }), []] as const),
        Match.when({ type: "text-end" as const }, () => [
          Idle(),
          [Response.makePart("text", { text: s.text })],
        ] as const),
        Match.orElse(() => [s, [part]] as const),
      ),

    Reasoning: (s) =>
      Match.value(part).pipe(
        Match.when({ type: "reasoning-delta" as const }, (p) => [
          Reasoning({ ...s, text: s.text + p.delta }),
          [],
        ] as const),
        Match.when({ type: "reasoning-end" as const }, () => [
          Idle(),
          [Response.makePart("reasoning", { text: s.text })],
        ] as const),
        Match.orElse(() => [s, [part]] as const),
      ),

    ToolParams: (s) =>
      Match.value(part).pipe(
        Match.when({ type: "tool-params-delta" as const }, (p) => [
          ToolParams({ ...s, deltas: s.deltas + p.delta }),
          [],
        ] as const),
        Match.when({ type: "tool-params-end" as const }, () => {
          let params: unknown;
          try {
            params = JSON.parse(s.deltas);
          } catch {
            params = undefined;
          }
          return [
            Idle(),
            [Response.makePart("tool-call", { id: s.id, name: s.name, params, providerExecuted: s.providerExecuted })],
          ] as const;
        }),
        Match.orElse(() => [s, [part]] as const),
      ),
  });

export const merge = <E, R>(
  stream: Stream.Stream<AnyStreamPart, E, R>,
): Stream.Stream<AnyPart, E, R> =>
  stream.pipe(
    Stream.mapAccum<AccumState, AnyStreamPart, AnyPart>(
      () => Idle(),
      (state, part) => matchPart(state, part),
    ),
  );
