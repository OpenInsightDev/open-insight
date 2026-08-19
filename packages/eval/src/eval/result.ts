import { Effect, Equal, Match, Sink } from "effect";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import { Prompt, Response } from "@open-insight/core/internal";
import { EvalError } from "./error.ts";

export const makeTrajSink = (
  id: Event.SessionID,
): Sink.Sink<Prompt.Trajectory, Event.EvalEvent, Event.EvalEvent, never> =>
  Sink.fold(
    () => ({ traj: Prompt.empty as Prompt.Trajectory, parts: [] as Response.AnyPart[] }),
    () => true,
    (state: { traj: Prompt.Trajectory; parts: Response.AnyPart[] }, event: Event.EvalEvent) =>
      Effect.sync(() => {
        if (!Equal.equals(event.id, id)) {
          return state;
        }

        return Match.value(event).pipe(
          Match.tag("SessionPromptEvent", (e) => ({
            traj:
              state.parts.length > 0
                ? state.traj
                    .pipe(Prompt.concat(Prompt.fromResponseParts(state.parts)))
                    .pipe(Prompt.concat(e.prompt))
                : state.traj.pipe(Prompt.concat(e.prompt)),
            parts: [],
          })),
          Match.tag("SessionStreamEvent", (e) => ({
            traj: state.traj,
            parts: [...state.parts, e.part],
          })),
          Match.tag("SessionEndEvent", () => ({
            traj:
              state.parts.length > 0
                ? state.traj.pipe(Prompt.concat(Prompt.fromResponseParts(state.parts)))
                : state.traj,
            parts: [],
          })),
          Match.orElse(() => state),
        );
      }),
  ).pipe(Sink.map((state) => state.traj));

export const makeResultSink = <T extends Task.AnyTask>(
  id: Event.BenchID,
): Sink.Sink<Event.BenchResult<Task.GradeTypeOf<T>>, Event.EvalEvent, never, EvalError> =>
  Sink.fold(
    () => Event.BenchResult.make({ id, tasks: {} }) as Event.BenchResult<Task.GradeTypeOf<T>>,
    () => true,
    () => {
      throw new Error("not implemented");
    },
  );
