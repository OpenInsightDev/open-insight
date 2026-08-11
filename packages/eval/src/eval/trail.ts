import { Harness, Sandbox, type Prompt } from "@open-insight/core/internal";
import { Effect, Stream, type Scope } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

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
  const { verifMode, graderMaxRetries: maxRetries } = config;

  const offer = Event.offerTo(eventQueue);

  const runTrail = Effect.fn(function* ({
    sbxSession,
    trailIdx,
  }: {
    sbxSession: Harness.SandboxSession;
    trailIdx: number;
  }) {
    const ctx = yield* Sandbox.asPromise(sbxSession.sandbox);
  });

  const runSession = Effect.fn(function* ({
    session,
    prompt,
  }: {
    session: Harness.AgentSession;
    prompt: Task.PromptFn;
  }) {});

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
