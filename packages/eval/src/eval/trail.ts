import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import { Effect, Stream, type Scope } from "effect";
import * as Bench from "#/bench/index.ts";
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
  snapSession: Harness.SnapshotSession;
}>;

export const createTrail = Effect.fn(function* ({
  task,
  bench,
  eventQueue,
  config,
  snapSession,
}: Options) {
  const harness = yield* Harness.Service;
  const harnessId = harness.metadata.id;
  const benchId = bench.metadata.id;

  const { metrics: taskMetrics, trajMetrics, sandboxConfig } = task;
  const { verifMode } = config;

  const offer = Event.offerTo(eventQueue);

  const runTrail = Effect.fn(function* ({
    sbxSession,
    trailIdx,
  }: {
    sbxSession: Harness.SandboxSession;
    trailIdx: number;
  }) {});

  const runSession = ({
    session,
    sandbox,
    trailIdx,
    sessionIdx,
  }: {
    session: Harness.AgentSession;
    sandbox: Sandbox.Sandbox;
    trailIdx: number;
    sessionIdx: number;
  }) =>
    Effect.fn(function* (): Effect.fn.Return<Response.Usage | null, EvalError, Scope.Scope> {
      const promptStream = Prompt.makeStream(task.prompt, {
        sandbox: yield* Sandbox.asPromise(sandbox),
        trajectory: session.trajectory,
      });

      let usage: Response.Usage | null = null;

      yield* promptStream.pipe(
        Stream.mapError(EvalError.taskExec(task, trailIdx)),
        Stream.zipWithIndex,
        Stream.runForEach(([prompt, idx]) =>
          session.prompt(prompt).pipe(
            Stream.mapError(EvalError.harness),
            Stream.tap((part) =>
              Event.SessionStreamEvent.makeEffect({
                benchId,
                harnessId,
                taskId: task.metadata.id,
                trailIdx,
                sessionIdx: sessionIdx + idx,
                part,
              }).pipe(offer),
            ),
            Stream.tap((part) =>
              part.type === "finish"
                ? Effect.sync(() => {
                    usage = part.usage;
                  })
                : Effect.void,
            ),
            Stream.runDrain,
          ),
        ),
      );

      return usage;
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
      .pipe(Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)));
});
