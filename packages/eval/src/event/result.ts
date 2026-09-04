import { Crypto, Effect, Match, Schema, Sink, Stream } from "effect";
import { Trajectory } from "@open-insight/core/internal";
import { Prompt, Response, Toolkit } from "effect/unstable/ai";
import { castDraft, enableMapSet, produce } from "immer";
import * as Task from "#/task/index.ts";
import type { TrailSuccessEvent } from "./schema.ts";

enableMapSet();

type Turn = Readonly<{
  prompt: Prompt.Prompt;
  parts: ReadonlyArray<Response.Part<{}>>;
}>;

type State = Readonly<{
  grade: unknown;
  sessions: ReadonlyMap<number, ReadonlyArray<Turn>>;
}>;

const initialState = (): State => ({ grade: undefined, sessions: new Map() });

const reduceState = (state: State, event: TrailSuccessEvent) =>
  produce(state, (draft) => {
    Match.value(event).pipe(
      Match.tagsExhaustive({
        TrailStartEvent: () => undefined,
        SessionStartEvent: ({ id }) => {
          draft.sessions.set(id.sessionIdx, []);
        },
        SessionPromptEvent: ({ id, prompt }) => {
          draft.sessions.get(id.sessionIdx)?.push({ prompt: castDraft(prompt), parts: [] });
        },
        SessionStreamEvent: ({ id, part }) => {
          draft.sessions.get(id.sessionIdx)?.at(-1)?.parts.push(castDraft(part));
        },
        SessionRetryEvent: () => undefined,
        SessionEndEvent: () => undefined,
        TrailEndEvent: ({ grade }) => {
          draft.grade = grade;
        },
        MetricEvent: () => undefined,
        MetricErrorEvent: () => undefined,
      }),
    );
  });

const encodeMessages = Schema.encodeEffect(Schema.mutable(Schema.Array(Trajectory.PromptMessage)));
const encodeResponse = Schema.encodeEffect(Response.AllPartsView(Toolkit.empty));

const encodeTurn = ({ prompt, parts }: Turn) => {
  const messages = prompt.content.filter(
    (message): message is Trajectory.PromptMessage => message.role !== "assistant",
  );
  return Stream.fromEffect(encodeMessages(messages)).pipe(
    Stream.concat(
      Stream.fromIterable(parts).pipe(Stream.mapEffect((part) => encodeResponse(part))),
    ),
  );
};

const makeSessionResult = Effect.fn("makeSessionResult")(function* (turns: ReadonlyArray<Turn>) {
  const parts = Stream.fromIterable(turns).pipe(Stream.flatMap(encodeTurn));
  const encoded = yield* Trajectory.makeEncoded(parts);
  const trajectory = yield* Trajectory.decode(encoded);
  return new Task.Result.SessionResult({ trajectory });
});

const makeTrailResult = Effect.fn("makeTrailResult")(function* (state: State) {
  const sessions = yield* Effect.forEach(state.sessions.values(), makeSessionResult);
  return new Task.Result.TrailResult({ grade: state.grade, sessions });
});

export const trailResult: Sink.Sink<
  Task.Result.TrailResult,
  TrailSuccessEvent,
  never,
  never,
  Crypto.Crypto
> = Sink.reduce(initialState, reduceState).pipe(Sink.mapEffect(makeTrailResult));
