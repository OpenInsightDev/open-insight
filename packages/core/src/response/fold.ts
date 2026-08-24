import { Stream } from "effect";
import { Prompt, Response, Tool } from "effect/unstable/ai";

type Metadata = Response.ProviderMetadata;
type Active =
  | { readonly kind: "text" | "reasoning"; readonly value: string; readonly metadata: Metadata }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly providerExecuted: boolean;
      readonly value: string;
      readonly metadata: Metadata;
    };
type State = ReadonlyMap<string, Active>;

const update = <A>(state: State, id: string, value: A): ReadonlyMap<string, A> => {
  const next = new Map(state as ReadonlyMap<string, A>);
  next.set(id, value);
  return next;
};

const remove = (state: State, id: string): State => {
  const next = new Map(state);
  next.delete(id);
  return next;
};

const metadata = (left: Metadata, right: Metadata): Metadata => ({ ...left, ...right });

const parse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const step = <Tools extends Record<string, Tool.Any>>(
  state: State,
  part: Response.StreamPart<Tools>,
): readonly [State, ReadonlyArray<Response.Part<Tools>>] => {
  switch (part.type) {
    case "text-start":
      return [update(state, part.id, { kind: "text", value: "", metadata: part.metadata }), []];
    case "reasoning-start":
      return [
        update(state, part.id, { kind: "reasoning", value: "", metadata: part.metadata }),
        [],
      ];
    case "tool-params-start":
      return [
        update(state, part.id, {
          kind: "tool",
          name: part.name,
          providerExecuted: part.providerExecuted,
          value: "",
          metadata: part.metadata,
        }),
        [],
      ];
    case "text-delta":
    case "reasoning-delta": {
      const current = state.get(part.id);
      const kind = part.type === "text-delta" ? "text" : "reasoning";
      return current?.kind === kind
        ? [
            update(state, part.id, {
              ...current,
              value: current.value + part.delta,
              metadata: metadata(current.metadata, part.metadata),
            }),
            [],
          ]
        : [state, []];
    }
    case "tool-params-delta": {
      const current = state.get(part.id);
      return current?.kind === "tool"
        ? [
            update(state, part.id, {
              ...current,
              value: current.value + part.delta,
              metadata: metadata(current.metadata, part.metadata),
            }),
            [],
          ]
        : [state, []];
    }
    case "text-end":
    case "reasoning-end": {
      const current = state.get(part.id);
      const kind = part.type === "text-end" ? "text" : "reasoning";
      return current?.kind === kind
        ? [
            remove(state, part.id),
            [
              Response.makePart(kind, {
                text: current.value,
                metadata: metadata(current.metadata, part.metadata),
              }) as Response.Part<Tools>,
            ],
          ]
        : [state, []];
    }
    case "tool-params-end": {
      const current = state.get(part.id);
      return current?.kind === "tool"
        ? [
            remove(state, part.id),
            [
              Response.makePart("tool-call", {
                id: part.id,
                name: current.name,
                params: parse(current.value),
                providerExecuted: current.providerExecuted,
                metadata: metadata(current.metadata, part.metadata),
              }) as Response.Part<Tools>,
            ],
          ]
        : [state, []];
    }
    case "error":
      return [state, []];
    default:
      return [state, [part as Response.Part<Tools>]];
  }
};

type PromptInput<Tools extends Record<string, Tool.Any>> =
  | Prompt.Prompt
  | Response.StreamPart<Tools>;

const stepPrompt = <Tools extends Record<string, Tool.Any>>(
  state: State,
  input: PromptInput<Tools>,
): readonly [State, ReadonlyArray<Prompt.Prompt | Response.Part<Tools>>] =>
  Prompt.isPrompt(input) ? [new Map(), [input]] : step(state, input);

export const fold = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
): Stream.Stream<Response.Part<Tools>, E, R> =>
  stream.pipe(
    Stream.mapAccum<State, Response.StreamPart<Tools>, Response.Part<Tools>>(() => new Map(), step),
  );

export const foldPrompt = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<PromptInput<Tools>, E, R>,
): Stream.Stream<Prompt.Prompt | Response.Part<Tools>, E, R> =>
  stream.pipe(
    Stream.mapAccum<State, PromptInput<Tools>, Prompt.Prompt | Response.Part<Tools>>(
      () => new Map(),
      stepPrompt,
    ),
  );
