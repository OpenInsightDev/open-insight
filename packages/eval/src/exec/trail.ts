import { Effect, FileSystem, Option, Path, Queue, Ref, Scope, Stream } from "effect";
import * as Task from "../task/index.ts";
import * as Metric from "../metric/index.ts";
import { Agent, Sandbox } from "@open-insight/core";
import { ExecError } from "./error.ts";
import { Response } from "effect/unstable/ai";
import { type Event, TaskStreamPartEvent } from "./event/index.ts";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { Config } from "./config.ts";

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    endpoint,
    config: { sandbox: { cacheAgentSnapshot, cacheTaskSnapshot } = {} } = {},
    metricQueue,
    eventQueue,
  }: {
    task: Task.Task;
    endpoint: Agent.Endpoint;
    config?: Config;
    metricQueue: Queue.Enqueue<Metric.Input>;
    eventQueue: Queue.Enqueue<Event>;
  }): Effect.fn.Return<
    Effect.Effect<void, ExecError, Scope.Scope>,
    ExecError,
    | Sandbox.ProviderService
    | Agent.ProviderService
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshot, resources, prompt, grader } = task;

    yield* Effect.annotateCurrentSpan({
      taskName: task.name,
    });
    yield* Effect.logDebug("Preparing derived snapshot");

    const sandboxProvider = yield* Sandbox.ProviderService;
    const agentProvider = yield* Agent.ProviderService;

    const taskSnapshot = yield* sandboxProvider
      .aquireSnapshot({ snapshot, cache: cacheTaskSnapshot })
      .pipe(Effect.mapError(ExecError.taskInit({ task: task.metadata })));

    const agentSnapshot = yield* agentProvider.snapshotExtension.pipe(
      Option.match({
        onSome: ({ instructions, context: extendContext }) =>
          sandboxProvider
            .deriveSnapshot({
              handle: taskSnapshot,
              instructions,
              context: extendContext,
              cache: cacheAgentSnapshot,
            })
            .pipe(Effect.mapError(ExecError.taskInit({ task: task.metadata }))),
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
          .pipe(Effect.mapError(ExecError.taskExec({ task: task.metadata, trailIndex })));

        yield* Effect.logDebug("Sandbox is ready, Starting trail execution");

        const provider = yield* Agent.ProviderService;
        const agent = yield* provider.runSession({ sandbox, endpoint });
        yield* Effect.logDebug("Started agent session");

        const stream = agent.prompt({ prompt });
        yield* Effect.logDebug("Attached prompt stream");

        const trajLength = yield* Ref.make(0);

        const tapDelta = Effect.fn("exec/runTrail/tapDelta")(function* (
          part: Response.StreamPart<any>,
        ) {
          yield* Queue.offer(
            eventQueue,
            TaskStreamPartEvent.make({
              bench: task.name,
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

        yield* stream.pipe(Stream.tap(tapDelta)).pipe(Stream.runDrain);

        const trajectory = yield* agent.trajectory();
        yield* Effect.logDebug(
          `Prompt stream completed with ${trajectory.content.length} trajectory message(s)`,
        );

        const ctx = {
          trajectory,
          ...Sandbox.asPromise(sandbox),
        } satisfies Task.Grade.Context;

        yield* Effect.logDebug(`Starting graders`);
        const gradeResults = yield* Task.Grade.run(grader)(ctx);
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
          Effect.mapError(ExecError.taskExec({ task: task.metadata, trailIndex })),
        ),
    );

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return Effect.gen(function* () {
      const trailIndex = yield* Ref.getAndUpdate(nextTrailIndex, (n) => n + 1);
      yield* Effect.logDebug(`Starting trail ${trailIndex}`);
      yield* runTrail(trailIndex)
        .pipe(
          Effect.provideService(Agent.ProviderService, agentProvider),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        )
        .pipe(
          Effect.annotateLogs({
            taskName: task.name,
          }),
        );
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
