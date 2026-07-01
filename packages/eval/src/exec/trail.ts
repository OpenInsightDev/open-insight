import { Effect, Queue, Ref, Scope, Stream } from "effect";
import * as Task from "../task/index.ts";
import * as Metric from "../metric/index.ts";
import { Agent, Sandbox } from "@open-insight/core/internal";
import { ExecError } from "./error.ts";
import { Response } from "effect/unstable/ai";

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    config,
    metricQueue,
    partQueue,
  }: {
    task: Task.Task;
    config?: Sandbox.Config;
    metricQueue: Queue.Enqueue<Metric.Input>;
    partQueue: Queue.Enqueue<Response.StreamPart<any>>;
  }): Effect.fn.Return<
    Effect.Effect<void, ExecError>,
    ExecError,
    Sandbox.ProviderService | Agent.ProviderService | Scope.Scope
  > {
    const { snapshot, context, resources, metadata } = task;

    yield* Effect.annotateCurrentSpan({
      taskName: metadata.name,
    });
    yield* Effect.logDebug("Preparing derived snapshot");

    const sandboxProvider = yield* Sandbox.ProviderService;
    const agentProvider = yield* Agent.ProviderService;

    const derived = yield* agentProvider
      .deriveSnapshot({ snapshot, context })
      .pipe(Effect.mapError(ExecError.taskInit({ task: metadata })));

    yield* Effect.logDebug("Prepared derived snapshot");

    yield* Effect.addFinalizer(
      Effect.fn("exec/createTrail/finalizeSnapshot")(function* () {
        if (!config?.cacheSnapshot) {
          yield* Effect.logDebug("Removing derived snapshot");
          yield* sandboxProvider.removeSnapshot({ snapshot: derived }).pipe(Effect.ignore);
        }
      }),
    );

    const nextTrailIndex = yield* Ref.make(0);

    const runTrail = Effect.fn("exec/runTrail")(
      function* ({ trailIndex, sandbox }: { trailIndex: number; sandbox: Sandbox.Sandbox }) {
        yield* Effect.annotateCurrentSpan({
          taskName: task.metadata.name,
          trailIndex,
        });
        yield* Effect.logDebug("Starting trail execution");

        const provider = yield* Agent.ProviderService;

        const { prompt, graders } = task;
        const agent = yield* provider.runSession({ sandbox });
        yield* Effect.logDebug("Started agent session");

        const stream = yield* agent.prompt({ prompt });
        yield* Effect.logDebug("Attached prompt stream");

        const trajLength = yield* Ref.make(0);

        const tapDelta = Effect.fn("exec/runTrail/tapDelta")(function* (
          part: Response.StreamPart<any>,
        ) {
          yield* Queue.offer(partQueue, part);

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
            trajectory,
            delta: Metric.Messages({ messages }),
          });
        });

        yield* stream.pipe(Stream.tap(tapDelta)).pipe(Stream.drain).pipe(Stream.runCollect);

        const trajectory = yield* agent.trajectory();
        yield* Effect.logDebug(
          `Prompt stream completed with ${trajectory.content.length} trajectory message(s)`,
        );

        const ctx = {
          trajectory,
          ...Sandbox.asPromise(sandbox),
        } satisfies Task.Grade.Context;

        yield* Effect.logDebug(`Starting graders`);
        const gradeResults = yield* Task.Grade.run(graders)(ctx);
        yield* Effect.logDebug(`Completed graders`);

        yield* Queue.offer(metricQueue, {
          task,
          trajectory,
          delta: Metric.Grade({ result: gradeResults }),
        });
        yield* Effect.logDebug("Published grade metric delta");
      },
      (effect, { trailIndex }) =>
        effect.pipe(
          Effect.annotateLogs({ taskName: metadata.name, trailIndex }),
          Effect.mapError(ExecError.taskExec({ task: metadata, trailIndex })),
        ),
    );

    return Effect.gen(function* () {
      const trailIndex = yield* Ref.getAndUpdate(nextTrailIndex, (n) => n + 1);

      yield* Effect.annotateCurrentSpan({
        taskName: metadata.name,
        trailIndex,
      });
      yield* Effect.logDebug("Starting sandbox for trail");

      const sandbox = yield* sandboxProvider
        .runSandbox({ snapshot: derived, resources })
        .pipe(Effect.mapError(ExecError.taskExec({ task: metadata, trailIndex })))
        .pipe(Effect.scoped);

      yield* Effect.logDebug("Sandbox is ready");

      yield* runTrail({ trailIndex, sandbox }).pipe(
        Effect.provideService(Agent.ProviderService, agentProvider),
      );
    }).pipe(
      Effect.annotateLogs({
        taskName: metadata.name,
      }),
    );
  },
  (effect, { task }) =>
    effect.pipe(
      Effect.annotateLogs({
        taskName: task.metadata.name,
      }),
    ),
);
