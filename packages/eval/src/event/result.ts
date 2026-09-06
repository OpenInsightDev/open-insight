import { Crypto, Effect, Match, Result, Schema, Sink, Stream } from "effect";
import { Trajectory } from "@open-insight/core/internal";
import { Prompt, Response, Toolkit } from "effect/unstable/ai";
import { castDraft, enableMapSet, produce } from "immer";
import * as Task from "#/task/index.ts";
import type { Event, EvalFailedEvent } from "./schema.ts";
import { EventError } from "./error.ts";

enableMapSet();

type Turn = Readonly<{
  prompt: Prompt.Prompt;
  parts: ReadonlyArray<Response.Part<{}>>;
}>;

type State = Readonly<{
  grade: unknown;
  sessions: ReadonlyMap<number, ReadonlyArray<Turn>>;
}>;

type ResultState = Result.Result<State, EvalFailedEvent>;

const stateSuccess = (state: State): ResultState => Result.succeed(state);
const stateFailure = (event: EvalFailedEvent): ResultState => Result.fail(event);

const initialState = (): ResultState =>
  stateSuccess({
    grade: undefined,
    sessions: new Map(),
  });

const reduceState = (state: ResultState, event: Event): ResultState => {
  if (Result.isFailure(state)) return state;

  return Match.value(event).pipe(
    Match.tagsExhaustive({
      TrailStartEvent: () => state,
      SessionStartEvent: ({ id }) =>
        stateSuccess(
          produce(state.success, (draft) => {
            draft.sessions.set(id.sessionIdx, []);
          }),
        ),
      SessionPromptEvent: ({ id, prompt }) =>
        stateSuccess(
          produce(state.success, (draft) => {
            draft.sessions.get(id.sessionIdx)?.push({ prompt: castDraft(prompt), parts: [] });
          }),
        ),
      SessionStreamEvent: ({ id, part }) =>
        stateSuccess(
          produce(state.success, (draft) => {
            draft.sessions.get(id.sessionIdx)?.at(-1)?.parts.push(castDraft(part));
          }),
        ),
      SessionRetryEvent: () => state,
      SessionEndEvent: () => state,
      TrailEndEvent: ({ grade }) =>
        stateSuccess(
          produce(state.success, (draft) => {
            draft.grade = grade;
          }),
        ),
      MetricEvent: () => state,
      MetricErrorEvent: () => state,
      TaskStartEvent: () => state,
      TaskEndEvent: () => state,
      EvalStartEvent: () => state,
      EvalEndEvent: () => state,
      SessionErrorEvent: stateFailure,
      TrailErrorEvent: stateFailure,
      TaskErrorEvent: stateFailure,
      EvalErrorEvent: stateFailure,
    }),
  );
};

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

const makeTrailResult = Effect.fn("makeTrailResult")(function* (state: ResultState) {
  if (Result.isFailure(state)) return state.failure;

  const sessions = yield* Effect.forEach(state.success.sessions.values(), makeSessionResult);
  return new Task.Result.TrailResult({ grade: state.success.grade, sessions });
});

export const trailResult: Sink.Sink<
  Task.Result.TrailResult | EvalFailedEvent,
  Event,
  never,
  EventError,
  Crypto.Crypto
> = Sink.reduce(initialState, reduceState).pipe(
  Sink.mapEffect(makeTrailResult),
  Sink.mapError(EventError.result),
);
