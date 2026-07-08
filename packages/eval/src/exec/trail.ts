import { Buffer } from "node:buffer";
import {
  DateTime,
  Effect,
  Equal,
  FileSystem,
  Option,
  Path,
  Queue,
  Ref,
  Scope,
  Stream,
} from "effect";
import * as Task from "../task/index.ts";
import * as Metric from "../metric/index.ts";
import { Agent, Sandbox } from "@open-insight/core";
import { Error } from "./error.ts";
import { Response, type Tool } from "effect/unstable/ai";
import {
  type Event,
  type StreamPart as EventStreamPart,
  TaskStreamPartEvent,
} from "./event/index.ts";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { Config } from "./config.ts";

type GenericResponseStreamPart = Response.StreamPart<Record<string, Tool.Any>>;

const encodeStreamPart = (part: GenericResponseStreamPart): EventStreamPart => {
  switch (part.type) {
    case "text-start":
      return { type: part.type, id: part.id, metadata: part.metadata };
    case "text-delta":
      return { type: part.type, id: part.id, delta: part.delta, metadata: part.metadata };
    case "text-end":
      return { type: part.type, id: part.id, metadata: part.metadata };
    case "reasoning-start":
      return { type: part.type, id: part.id, metadata: part.metadata };
    case "reasoning-delta":
      return { type: part.type, id: part.id, delta: part.delta, metadata: part.metadata };
    case "reasoning-end":
      return { type: part.type, id: part.id, metadata: part.metadata };
    case "tool-params-start":
      return {
        type: part.type,
        id: part.id,
        name: part.name,
        providerExecuted: part.providerExecuted,
        metadata: part.metadata,
      };
    case "tool-params-delta":
      return { type: part.type, id: part.id, delta: part.delta, metadata: part.metadata };
    case "tool-params-end":
      return { type: part.type, id: part.id, metadata: part.metadata };
    case "tool-call":
      return {
        type: part.type,
        id: part.id,
        name: part.name,
        params: part.params,
        providerExecuted: part.providerExecuted,
        metadata: part.metadata,
      };
    case "tool-result":
      return {
        type: part.type,
        id: part.id,
        name: part.name,
        result: part.encodedResult,
        isFailure: part.isFailure,
        providerExecuted: part.providerExecuted,
        preliminary: part.preliminary,
        metadata: part.metadata,
      };
    case "tool-approval-request":
      return {
        type: part.type,
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        metadata: part.metadata,
      };
    case "file":
      return {
        type: part.type,
        mediaType: part.mediaType,
        data: Buffer.from(part.data).toString("base64"),
        metadata: part.metadata,
      };
    case "source":
      if (part.sourceType === "document") {
        return {
          type: part.type,
          sourceType: part.sourceType,
          id: part.id,
          title: part.title,
          mediaType: part.mediaType,
          fileName: part.fileName,
          metadata: part.metadata,
        };
      }
      return {
        type: part.type,
        sourceType: part.sourceType,
        id: part.id,
        title: part.title,
        url: part.url.href,
        metadata: part.metadata,
      };
    case "response-metadata":
      return {
        type: part.type,
        id: part.id,
        modelId: part.modelId,
        timestamp: part.timestamp === undefined ? undefined : DateTime.formatIso(part.timestamp),
        request: part.request,
        metadata: part.metadata,
      };
    case "finish":
      return {
        type: part.type,
        reason: part.reason,
        usage: part.usage,
        response: part.response,
        metadata: part.metadata,
      };
    case "error":
      return { type: part.type, error: part.error, metadata: part.metadata };
  }
};

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    config: { verifMode = false, sandbox: { cacheAgentSnapshot, cacheTaskSnapshot } = {} } = {},
    metricQueue,
    eventQueue,
  }: {
    task: Task.Task;
    config?: Config;
    metricQueue: Queue.Enqueue<Metric.Input>;
    eventQueue: Queue.Enqueue<Event>;
  }): Effect.fn.Return<
    Effect.Effect<void, Error, Scope.Scope>,
    Error,
    | Sandbox.ProviderService
    | Agent.ProviderService
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshot, resources, prompt, grader, verifier } = task;

    yield* Effect.annotateCurrentSpan({
      taskName: task.name,
    });

    if (verifMode && verifier === undefined) {
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
          part: GenericResponseStreamPart,
        ) {
          yield* Queue.offer(
            eventQueue,
            TaskStreamPartEvent.make({
              bench: task.name,
              task: task.name,
              parts: [encodeStreamPart(part)],
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

        const sandboxPromise = yield* Sandbox.asPromise(sandbox);
        const ctx = {
          trajectory,
          ...sandboxPromise,
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
          Effect.mapError(Error.taskExec(task, trailIndex)),
        ),
    );

    const runVerifTrail = Effect.fn(
      function* (trailIndex: number) {
        if (verifier === undefined) {
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
          try: () => verifier.exec(sandboxPromise),
          catch: Error.taskExec(task, trailIndex),
        }).pipe(Effect.mapError(Error.taskVerifExec(task)));

        yield* Effect.logDebug("Starting verifier");
        const gradeResults = yield* Task.Grade.run(grader)({
          trajectory,
          ...sandboxPromise,
        });
        yield* Effect.logDebug("Completed verifier");

        if (!Equal.equals(gradeResults, verifier.expected)) {
          return yield* Effect.fail(
            Error.taskVerif(
              task.metadata,
              verifier.expected,
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

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return Effect.gen(function* () {
      const trailIndex = yield* Ref.getAndUpdate(nextTrailIndex, (n) => n + 1);
      yield* Effect.logDebug(`Starting trail ${trailIndex}`);

      const run = verifMode ? runVerifTrail : runTrail;
      yield* run(trailIndex)
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
