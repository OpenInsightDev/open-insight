import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import { Effect, Match, Queue, Ref, Scope, Semaphore, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

export type TrailEventStream = (trailIdx: number) => Stream.Stream<Event.EvalEvent>;

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;
  eventQueue: Event.EventEnqueue;

  trailSem: Semaphore.Semaphore;
  snapSem: Semaphore.Semaphore;
}>;

export const createTrail = Effect.fn(function* ({
  task,
  bench,
  eventQueue,
  config,
  trailSem,
  snapSem,
}: Options) {
  const harness = yield* Harness.Service;

  const taskFields = {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
    taskId: task.metadata.id,
  };

  const { metrics: taskMetrics, trajMetrics, sandboxConfig, grader, snapshot: taskTemplate } = task;
  const { verifMode } = config;

  const offer = Event.offerTo(eventQueue);

  const scope = yield* Scope.Scope;

  const snapSession = yield* harness.runSnapshot(taskTemplate).pipe(snapSem.withPermit);

  const runGrader = yield* Grade.createRunner(grader).pipe(Effect.mapError(EvalError.grade));

  const runTrail = Effect.fn(function* ({
    sbxSession,
    trailIdx,
  }: {
    sbxSession: Harness.SandboxSession;
    trailIdx: number;
  }) {
    const trailFields = { ...taskFields, trailIdx };
  });

  const runSession = Effect.fn(function* ({
    sandbox,
    session,
    trailIdx,
    sessionIdx,
  }: {
    sandbox: Sandbox.Sandbox;
    session: Harness.AgentSession;
    trailIdx: number;
    sessionIdx: number;
  }): Effect.fn.Return<Queue.Dequeue<Event.EvalEvent, EvalError>, EvalError, Scope.Scope> {
    const sessionFields = { ...taskFields, trailIdx, sessionIdx };

    const queue = yield* Event.makeQueue();
    const offer = Event.offerTo(queue);

    yield* Event.SessionStartEvent.makeEffect({ ...sessionFields }).pipe(offer);

    const promptStream = Prompt.makeStream(task.prompt, {
      sandbox: yield* Sandbox.asPromise(sandbox),
      trajectory: session.trajectory,
    }).pipe(Stream.mapError(EvalError.taskExec(task, trailIdx)));

    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    yield* promptStream
      .pipe(
        Stream.runForEach(
          Effect.fn(function* (prompt) {
            yield* Event.SessionPromptEvent.makeEffect({ ...sessionFields, prompt }).pipe(offer);

            yield* session
              .prompt(prompt)
              .pipe(Stream.mapError(EvalError.harness))
              .pipe(
                Stream.tap(
                  Effect.fn(function* (part) {
                    if (part.type !== "finish") {
                      return;
                    }
                    yield* Ref.set(finishRef, part.reason);
                  }),
                ),
                Stream.tap((part) =>
                  Event.SessionStreamEvent.makeEffect({ ...sessionFields, part }).pipe(offer),
                ),
                Stream.runDrain,
              );
          }),
        ),
      )
      .pipe(
        Effect.catch((error) =>
          Event.SessionErrorEvent.makeEffect({ ...sessionFields, error })
            .pipe(offer)
            .pipe(Effect.andThen(Effect.fail(error))),
        ),
      );

    const reason = yield* Ref.get(finishRef);

    yield* Event.SessionEndEvent.makeEffect({ ...sessionFields, reason }).pipe(offer);

    return Queue.asDequeue(queue);
  });

  return (trailIdx) =>
    Effect.logDebug(`Trail ${trailIdx} started`)
      .pipe(() =>
        snapSession.runSandbox(sandboxConfig).pipe(
          Effect.mapError(EvalError.harness),
          Effect.flatMap((sbxSession) => runTrail({ sbxSession, trailIdx })),
          Effect.scoped,
        ),
      )
      .pipe(Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)))
      .pipe(trailSem.withPermit);
});
