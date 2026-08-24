import { Cause, Effect, Match, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import { Response, Toolkit } from "effect/unstable/ai";
import { type Any } from "./eval.ts";
import * as Task from "#/task/index.ts";
import * as Event from "#/event/index.ts";
import { Harness, Prompt, type Sandbox } from "@open-insight/core/internal";
import { EvalError } from "./error.ts";
import type { Config } from "./config.ts";

type SessionOptions = Readonly<{
  id: Event.SessionID;
  sandbox: Sandbox.Sandbox;
  agentSession: Harness.AgentSession;
}>;
const makeSession = Effect.fn(
  function* ({ id, sandbox, agentSession }: SessionOptions) {
    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const promptFn = yield* Prompt.Fn.Service;
    const { init, respond } = yield* promptFn.make(sandbox).pipe(Effect.mapError(EvalError.prompt));

    const decodePart = Schema.decodeSync(Response.StreamPart(Toolkit.empty));

    const session = Stream.callback<Prompt.Prompt | Response.AnyPart, EvalError>(
      Effect.fn(function* (queue) {
        let current: Option.Option<Prompt.Prompt> = Option.some(init);
        while (Option.isSome(current)) {
          yield* Queue.offer(queue, current.value);

          const response = agentSession
            .prompt(current.value)
            .pipe(Stream.mapError(EvalError.harness))
            .pipe(
              Stream.tap(
                Effect.fn(function* (part) {
                  if (part.type !== "finish") {
                    return;
                  }
                  yield* Effect.all([
                    Ref.set(finishRef, part.reason),
                    Ref.set(usageRef, part.usage),
                  ]);
                }),
              ),
            );

          yield* response.pipe(Stream.runForEach((part) => Queue.offer(queue, decodePart(part))));

          const trajectory = yield* Ref.get(agentSession.trajectory);
          current = yield* respond(trajectory).pipe(Effect.mapError(EvalError.prompt));
        }
      }),
    );

    const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));

    const turnEvents = session.pipe(
      Stream.map((part) =>
        Match.value(part).pipe(
          Match.when(Prompt.isPrompt, (prompt) => Event.SessionPromptEvent.make({ id, prompt })),
          Match.orElse((part) => Event.SessionStreamEvent.make({ id, part })),
        ),
      ),
    );

    const endEvent = Effect.all([Ref.get(finishRef), Ref.get(usageRef)]).pipe(
      Effect.map(([reason, usage]) => Event.SessionEndEvent.make({ id, reason, usage })),
      Stream.fromEffect,
    );

    const result = Effect.all({
      usage: Ref.get(usageRef),
      trajectory: Ref.get(agentSession.trajectory),
    }).pipe(
      Effect.flatMap(({ usage, trajectory }) =>
        Effect.fail(new Task.Result.SessionResult({ usage, trajectory })),
      ),
      Stream.fromEffect,
    );

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(turnEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.SessionErrorEvent.make({ id, error })),
      ),
    ),
);

type TrailOptions<T extends Task.Any> = Readonly<{
  id: Event.TrailID;
  task: T;
  snapSession: Harness.SnapshotSession;
}>;
const makeTrail = Effect.fn(
  function* <T extends Task.Any>({ id, task, snapSession }: TrailOptions<T>) {
    const { resources, schedMetrics, prompt } = task;

    const sbxSession = yield* snapSession
      .runSandbox({ resources })
      .pipe(Effect.mapError(EvalError.harness));
    const sandbox = sbxSession.sandbox;

    const runGrader = yield* Grade.Service;

    const sessionResultQueue = yield* Queue.make<Task.Result.SessionResult, Cause.Done>();

    const makeAttempt = ({
      agentSession,
      sessionIdx,
    }: {
      agentSession: Harness.AgentSession;
      sessionIdx: number;
    }) =>
      Effect.gen(function* () {
        const sessionID: Event.SessionID = { ...id, sessionIdx };

        const session = makeSession({ id: sessionID, agentSession, sandbox }).pipe(
          Stream.catchTag("SessionResult", (result) =>
            Stream.empty.pipe(Stream.onStart(Queue.offer(sessionResultQueue, result))),
          ),
        );

        const gradeResult = Effect.gen(function* () {
          const trajectory = yield* Ref.get(agentSession.trajectory);

          const grade = yield* runGrader<Task.GradeOf<T>>({
            sandbox: sbxSession.sandbox,
            trajectory,
          }).pipe(Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))));

          const endEvent = Stream.succeed(Event.TrailEndEvent.make({ id, grade }));

          yield* Queue.end(sessionResultQueue);
          const sessions = yield* Queue.collect(sessionResultQueue);
          const result = Stream.fail(new Task.Result.TrailResult({ grade, sessions }));

          return Stream.empty.pipe(Stream.concat(endEvent), Stream.concat(result));
        }).pipe(Stream.unwrap);

        const makeRetry = (retry: Grade.Retry) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `Grader requested a "${retry.type}" retry for trail ${id.trailIdx}: ${retry.reason ?? "unknown reason"}`,
            );

            const nextSession = yield* Match.value(retry.type).pipe(
              Match.when("restart", () =>
                sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness)),
              ),
              Match.when("continue", () => Effect.succeed(agentSession)),
              Match.exhaustive,
            );
            const nextAttempt = makeAttempt({
              agentSession: nextSession,
              sessionIdx: sessionIdx + 1,
            });

            const retryEvent = Stream.succeed(
              Event.SessionRetryEvent.make({ id: sessionID, reason: retry.reason }),
            );

            return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
          }).pipe(Stream.unwrap);

        const grade = gradeResult.pipe(Stream.catchTag("Retry", makeRetry));
        // return Stream.empty.pipe(Stream.concat(session), Stream.concat(grade));
        return Stream.empty;
      }).pipe(Stream.unwrap);

    const startEvent = Stream.succeed(
      Event.TrailStartEvent.make({
        id,
        schedMetrics: schedMetrics.map((metric) => metric.metadata),
      }),
    );

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const attemptEvents = makeAttempt({ agentSession, sessionIdx: 0 }).pipe(Stream.provide(prompt));

    return Stream.empty.pipe(Stream.concat(startEvent), Stream.concat(attemptEvents));
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TrailErrorEvent.make({ id, error })),
      ),
    ),
);

type TaskOptions<T extends Task.Any> = Readonly<{
  id: Event.TaskID;

  task: T;

  bench: Bench.Any;
  harness: Harness.Any;

  config: Config;
  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;
  trailCount: number;
}>;
const makeTask = Effect.fn(function* <T extends Task.Any>(options: TaskOptions<T>) {});

type EvalOptions<Eval extends Any> = Readonly<{
  eval: Eval;
}>;
export const make = Effect.fn(function* <Eval extends Any>(options: EvalOptions<Eval>) {});
