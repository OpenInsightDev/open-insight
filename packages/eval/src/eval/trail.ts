import { Effect, Equal, FileSystem, Option, Path, Queue, Ref, Scope, Stream } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Task from "../task/index.ts";
import * as Metric from "../metric/index.ts";
import { Agent, Sandbox } from "@open-insight/core";
import { Error } from "./error.ts";
import { Prompt, Response } from "effect/unstable/ai";
import { type Event, TaskStreamPartEvent } from "./event/index.ts";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { Config } from "./config.ts";

export type RunTrail = Effect.Effect<void, Error, Scope.Scope>;

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    bench,
    harness,
    config = {},
    metricQueue,
    eventQueue,
  }: {
    task: Task.Task;
    bench: string;
    harness: string;
    config?: Config;
    metricQueue: Queue.Enqueue<Metric.Input>;
    eventQueue: Queue.Enqueue<Event>;
  }): Effect.fn.Return<
    RunTrail,
    Error,
    | Sandbox.ProviderService
    | Agent.ProviderService
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshot, resources, prompt, grader, verifier } = task;
    const { verifMode = false, sandbox: { cacheAgentSnapshot, cacheTaskSnapshot } = {} } = config;

    yield* Effect.annotateCurrentSpan({
      taskName: task.name,
    });

    if (verifMode && !verifier) {
      yield* Effect.logDebug("Skipping task without verifier");
      return Effect.void;
    }

    yield* Effect.logDebug("Preparing derived snapshot");

    const sandboxProvider = yield* Sandbox.ProviderService;
    const agentProvider = yield* Agent.ProviderService;

    const taskSnapshot = yield* sandboxProvider
      .aquireSnapshot({ snapshot, cache: cacheTaskSnapshot })
      .pipe(Effect.mapError(Error.taskInit(task)));

    const agentSnapshot = verifMode
      ? taskSnapshot
      : yield* agentProvider.snapshotExtension.pipe(
          Option.match({
            onSome: ({ instructions, context: extendContext }) =>
              sandboxProvider
                .deriveSnapshot({
                  handle: taskSnapshot,
                  instructions,
                  context: extendContext ?? snapshot.context,
                  cache: cacheAgentSnapshot,
                })
                .pipe(Effect.mapError(Error.taskInit(task))),
            onNone: () => Effect.succeed(taskSnapshot),
          }),
        );

    yield* Effect.logDebug("Prepared derived snapshot");

    const nextTrailIndex = yield* Ref.make(0);

    const runTrail = Effect.fn(
      function* (trailIndex: number) {
        yield* Effect.annotateCurrentSpan({
          taskName: task.name,
          trailIndex,
        });

        yield* Effect.logDebug("Starting sandbox for trail");

        const sandbox = yield* sandboxProvider
          .runSandbox({ handle: agentSnapshot, resources })
          .pipe(Effect.mapError(Error.taskExec(task, trailIndex)));

        yield* Effect.logDebug("Sandbox is ready, Starting trail execution");

        const provider = yield* Agent.ProviderService;
        const agent = yield* provider.runSession({ sandbox });
        yield* Effect.logDebug("Started agent session");

        const stream = agent.prompt({ prompt });
        yield* Effect.logDebug("Attached prompt stream");

        const trajLength = yield* Ref.make(0);

        const tapDelta = Effect.fn("exec/runTrail/tapDelta")(function* (
          part: Response.StreamPart<never>,
        ) {
          yield* Queue.offer(
            eventQueue,
            TaskStreamPartEvent.make({
              bench,
              harness,
              task: task.name,
              parts: [part],
              trailIndex,
            }),
          );

          const trajectory = yield* agent.trajectory();
          const prevTrajLength = yield* Ref.get(trajLength);
          const currTrajLength = trajectory.content.length;

          // not every part makes a new message
          if (currTrajLength === prevTrajLength) {
            return;
          }

          const messages = trajectory.content.slice(prevTrajLength, currTrajLength);

          yield* Ref.set(trajLength, currTrajLength);
          yield* Queue.offer(metricQueue, {
            task,
            trailIndex,
            trajectory,
            delta: Metric.Messages({ messages }),
          });
        });

        yield* stream.pipe(Stream.runForEach(tapDelta));

        const trajectory = yield* agent.trajectory();
        yield* Effect.logDebug(
          `Prompt stream completed with ${trajectory.content.length} trajectory message(s)`,
        );

        const sandboxPromise = yield* Sandbox.asPromise(sandbox);
        yield* Effect.logDebug(`Starting graders`);
        const gradeResults = yield* Grade.run(grader)({
          trajectory,
          ...sandboxPromise,
        });
        yield* Effect.logDebug(`Completed graders`);

        yield* Queue.offer(metricQueue, {
          task,
          trailIndex,
          trajectory,
          delta: Metric.Grade({ result: gradeResults }),
        });
        yield* Effect.logDebug("Published grade metric delta");
      },
      (effect, trailIndex) =>
        effect.pipe(
          Effect.annotateLogs({ taskName: task.name, trailIndex }),
          Effect.mapError(Error.taskExec(task, trailIndex)),
        ),
    );

    const runVerifTrail = Effect.fn(
      function* (trailIndex: number) {
        if (!verifier) {
          return;
        }

        yield* Effect.annotateCurrentSpan({
          taskName: task.name,
          trailIndex,
        });

        yield* Effect.logDebug("Starting sandbox for verifier");
        const sandbox = yield* sandboxProvider
          .runSandbox({ handle: taskSnapshot, resources })
          .pipe(Effect.mapError(Error.taskExec(task, trailIndex)));

        yield* Effect.logDebug("Running verifier");
        const sandboxPromise = yield* Sandbox.asPromise(sandbox);
        const trajectory = yield* Effect.tryPromise({
          try: () => verifier.exec(sandboxPromise).then((result) => result ?? Prompt.empty),
          catch: Error.taskExec(task, trailIndex),
        }).pipe(Effect.mapError(Error.taskVerifExec(task)));

        yield* Effect.logDebug("Starting verifier");
        const gradeResults = yield* Grade.run(grader)({
          trajectory,
          ...sandboxPromise,
        });
        yield* Effect.logDebug("Completed verifier");

        if (!Equal.equals(gradeResults, verifier.expect)) {
          return yield* Effect.fail(
            Error.taskVerif(
              task.metadata,
              verifier.expect,
              gradeResults,
            )(new globalThis.Error("Verifier result did not match expected result")),
          );
        }

        yield* Queue.offer(metricQueue, {
          task,
          trailIndex,
          trajectory,
          delta: Metric.Grade({ result: gradeResults }),
        });
        yield* Effect.logDebug("Published verifier grade metric delta");
      },
      (effect, trailIndex) =>
        effect
          .pipe(Effect.mapError(Error.taskExec(task, trailIndex)))
          .pipe(Effect.annotateLogs({ taskName: task.name, trailIndex })),
    );

    return Effect.gen(function* () {
      const trailIndex = yield* Ref.getAndUpdate(nextTrailIndex, (n) => n + 1);
      yield* Effect.logDebug(`Starting trail ${trailIndex}`);

      const run = verifMode ? runVerifTrail : runTrail;
      yield* run(trailIndex)
        .pipe(Effect.provideService(Agent.ProviderService, agentProvider))
        .pipe(
          Effect.annotateLogs({
            taskName: task.name,
          }),
        )
        .pipe(Effect.scoped);
      yield* Effect.logDebug(`Completed trail ${trailIndex}`);
    });
  },
  (effect, { task }) =>
    effect.pipe(
      Effect.annotateLogs({
        taskName: task.name,
      }),
    ),
);
