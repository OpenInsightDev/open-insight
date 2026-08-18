import { Prompt, Response } from "@open-insight/core/internal";
import { Effect, Match, Sink } from "effect";
import { SessionResult as SessionResultSchema } from "./result.ts";
import type { BenchResult, SessionResult, TaskResult, TrailResult } from "./result.ts";
import type {
  BenchSuccessEvent,
  SessionSuccessEvent,
  TaskSuccessEvent,
  TrailSuccessEvent,
} from "./schema.ts";

type SessionFoldState = Readonly<{
  usage: Response.Usage | null;
  trajectory: Prompt.Trajectory;
  response: ReadonlyArray<Response.AnyPart>;
  done: boolean;
  result?: SessionResult;
}>;

const commitResponse = (state: SessionFoldState): SessionFoldState => ({
  ...state,
  trajectory: Prompt.concat(state.trajectory, Prompt.fromResponseParts(state.response)),
  response: [],
});

export const makeSession = (): Sink.Sink<SessionResult, SessionSuccessEvent> =>
  Sink.fold<SessionFoldState, SessionSuccessEvent>(
    (): SessionFoldState => ({
      usage: null,
      trajectory: Prompt.empty,
      response: [],
      done: false,
    }),
    (state) => !state.done,
    (state, event) =>
      Effect.succeed(
        Match.value(event).pipe(
          Match.tag("SessionStartEvent", () => state),
          Match.tag("SessionPromptEvent", ({ prompt }) => {
            const current = commitResponse(state);
            return { ...current, trajectory: Prompt.concat(current.trajectory, prompt) };
          }),
          Match.tag("SessionStreamEvent", ({ part }) => ({
            ...state,
            responseParts: [...state.response, part],
            usage: Match.value(part).pipe(
              Match.when({ type: "finish" }, ({ usage }) => usage),
              Match.orElse(() => state.usage),
            ),
          })),
          Match.tag("SessionEndEvent", ({ endAt }) => {
            const current = commitResponse(state);
            return {
              ...current,
              done: true,
              result: SessionResultSchema.make({
                finishedAt: endAt,
                usage: state.usage,
                trajectory: current.trajectory,
              }),
            };
          }),
          Match.orElse(() => state),
        ),
      ),
  ).pipe(
    Sink.map((state) => {
      if (state.done && state.result !== undefined) {
        return state.result;
      }
      throw new Error("Session stream ended before SessionEndEvent");
    }),
    Sink.ignoreLeftover,
  );

export const makeTrail = (): Sink.Sink<TrailResult, TrailSuccessEvent> =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);

export const makeTask = (): Sink.Sink<TaskResult, TaskSuccessEvent> =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);

export const make = (): Sink.Sink<BenchResult, BenchSuccessEvent> =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);
