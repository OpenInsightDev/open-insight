import { Data, Match, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { AnyAggPart, AnyPart } from "./schema.ts";

type AccumState = Data.TaggedEnum<{
  Idle: {};
  Text: { readonly id: string; readonly text: string };
  Reasoning: { readonly id: string; readonly text: string };
  ToolParams: {
    readonly id: string;
    readonly name: string;
    readonly providerExecuted: boolean;
    readonly deltas: string;
  };
}>;

const { Idle, Text, Reasoning, ToolParams, $match } = Data.taggedEnum<AccumState>();

// `as AnyAggPart` casts are safe: only non-streaming parts reach pass-through on well-formed streams.
const matchPart = (
  state: AccumState,
  part: AnyPart | unknown,
): readonly [AccumState, readonly AnyAggPart[]] => {
  if (!Response.isPart(part)) {
    return [state, []];
  }

  return $match(state, {
    Idle: () =>
      Match.value(part).pipe(
        Match.when(
          { type: "text-start" as const },
          (p) => [Text({ id: p.id, text: "" }), []] as const,
        ),
        Match.when(
          { type: "reasoning-start" as const },
          (p) => [Reasoning({ id: p.id, text: "" }), []] as const,
        ),
        Match.when(
          { type: "tool-params-start" as const },
          (p) =>
            [
              ToolParams({
                id: p.id,
                name: p.name,
                providerExecuted: p.providerExecuted,
                deltas: "",
              }),
              [],
            ] as const,
        ),
        Match.orElse(() => [state, [part as AnyAggPart]] as const),
      ),

    Text: (s) =>
      Match.value(part).pipe(
        Match.when(
          { type: "text-delta" as const },
          (p) => [Text({ ...s, text: s.text + p.delta }), []] as const,
        ),
        Match.when(
          { type: "text-end" as const },
          () => [Idle(), [Response.makePart("text", { text: s.text })]] as const,
        ),
        Match.orElse(() => [s, [part as AnyAggPart]] as const),
      ),

    Reasoning: (s) =>
      Match.value(part).pipe(
        Match.when(
          { type: "reasoning-delta" as const },
          (p) => [Reasoning({ ...s, text: s.text + p.delta }), []] as const,
        ),
        Match.when(
          { type: "reasoning-end" as const },
          () => [Idle(), [Response.makePart("reasoning", { text: s.text })]] as const,
        ),
        Match.orElse(() => [s, [part as AnyAggPart]] as const),
      ),

    ToolParams: (s) =>
      Match.value(part).pipe(
        Match.when(
          { type: "tool-params-delta" as const },
          (p) => [ToolParams({ ...s, deltas: s.deltas + p.delta }), []] as const,
        ),
        Match.when({ type: "tool-params-end" as const }, () => {
          let params: unknown;
          try {
            params = JSON.parse(s.deltas);
          } catch {
            params = undefined;
          }
          return [
            Idle(),
            [
              Response.makePart("tool-call", {
                id: s.id,
                name: s.name,
                params,
                providerExecuted: s.providerExecuted,
              }),
            ],
          ] as const;
        }),
        Match.orElse(() => [s, [part as AnyAggPart]] as const),
      ),
  });
};

/**
 * Folds all streaming parts (e.g. text-start/delta/end) in a response stream into aggregated parts (e.g. text).
 */
export const fold = <E, R>(stream: Stream.Stream<AnyPart, E, R>): Stream.Stream<AnyAggPart, E, R> =>
  stream.pipe(
    Stream.mapAccum<AccumState, AnyPart, AnyAggPart>(
      () => Idle(),
      (state, part) => matchPart(state, part as AnyPart),
    ),
  );
