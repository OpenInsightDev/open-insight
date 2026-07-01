import { assert, describe, it } from "@effect/vitest";
import * as NodePlatform from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect";
import { AiError, Prompt, Response } from "effect/unstable/ai";
import { Agent, Sandbox } from "@open-insight/core/internal";
import * as Schedule from "@/exec/schedule.ts";
import { ExecError } from "@/exec/error.ts";
import { EventTransportService, type Event, type EventTransport } from "@/exec/event/index.ts";
import * as Metric from "@/metric/index.ts";
import * as Task from "@/task/index.ts";

const makeSandbox = (): Sandbox.Sandbox => ({
  $: () => Effect.succeed(""),
  readFile: ({ sandboxPath }) => Effect.succeed(`read:${sandboxPath}`),
  writeFile: () => Effect.void,
  download: () => Effect.void,
  upload: () => Effect.void,
  expose: ({ hostPort }) => Effect.succeed({ hostUrl: `http://127.0.0.1:${hostPort}` }),
});

const makeTask = (name: string): Task.Task => ({
  metadata: { name },
  prompt: [
    Prompt.userMessage({
      content: [Prompt.textPart({ text: `solve ${name}` })],
    }),
  ],
  graders: {
    score: async ({ trajectory }) => trajectory.content.length,
  },
  snapshot: Sandbox.Snapshot.make({
    image: "open-insight/schedule-test:latest",
    instructions: [],
  }),
  context: Sandbox.Context.make(import.meta.dirname),
  gradeContext: null,
  resources: null,
});

const makeContextTask = (
  name: string,
  expectedContext: string,
  setContext: (context: string) => void,
): Task.Task => ({
  metadata: { name },
  prompt: [
    Prompt.userMessage({
      content: [Prompt.textPart({ text: `solve ${name}` })],
    }),
  ],
  graders: {
    score: async ({ trajectory, context }) => {
      setContext(context);
      assert.strictEqual(context, expectedContext);
      return trajectory.content.length;
    },
  },
  snapshot: Sandbox.Snapshot.make({
    image: "open-insight/schedule-test:latest",
    instructions: [],
  }),
  context: yield * Sandbox.Context.make(expectedContext),
  gradeContext: null,
  resources: null,
});

const makeAgentError = (method: string): Agent.AgentError =>
  Agent.AgentError.stream(
    new AiError.AiError({
      module: "schedule.test",
      method,
      reason: new AiError.UnknownError({ description: `${method} failed` }),
    }),
  );

const makeSandboxError = (operation: string): Sandbox.SandboxError =>
  Sandbox.SandboxError.provider("schedule.test")(new Error(`${operation} failed`));

const eventSummary = (event: Event): string => {
  switch (event._tag) {
    case "InitEvent":
      return `init:${event.bench.name}:${event.tasks.map((task) => task.name).join(",")}`;
    case "BenchScheduleEvent":
      return `bench:${event.op}:${event.bench}`;
    case "TaskScheduleEvent":
      return `task:${event.op}:${event.task}`;
    case "TaskStreamPartEvent":
      return `part:${event.task}:${event.trailIndex}:${event.parts.map((part) => part.type).join(",")}`;
    case "MetricsStreamEvent":
      return `metric:${event.output._tag}:${event.output.name}`;
  }
};

type TestProviderOptions = Readonly<{
  failAgentDeriveSnapshot?: boolean;
  failRunSandbox?: boolean;
  transport?: EventTransport;
}>;

const makeTestProviders = Effect.fn(function* (
  events: Array<Event>,
  options: TestProviderOptions = {},
) {
  const derivedSnapshots = yield* Ref.make(0);
  const removedSnapshots = yield* Ref.make(0);
  const sandboxes = yield* Ref.make(0);
  const sessions = yield* Ref.make(0);

  const sandboxProvider = {
    ensureSnapshot: () => Effect.void,
    deriveSnapshot: () => Effect.void,
    removeSnapshot: () => Ref.update(removedSnapshots, (count) => count + 1),
    runSandbox: () =>
      Effect.gen(function* () {
        yield* Ref.update(sandboxes, (count) => count + 1);

        if (options.failRunSandbox) {
          return yield* Effect.fail(makeSandboxError("runSandbox"));
        }

        return makeSandbox();
      }),
  } satisfies Sandbox.Provider;

  const agentProvider = {
    deriveSnapshot: ({ snapshot }) =>
      Effect.gen(function* () {
        yield* Ref.update(derivedSnapshots, (count) => count + 1);

        if (options.failAgentDeriveSnapshot) {
          return yield* Effect.fail(makeAgentError("deriveSnapshot"));
        }

        return snapshot;
      }),
    runSession: () =>
      Ref.update(sessions, (count) => count + 1).pipe(
        Effect.as({
          trajectory: () =>
            Effect.succeed(
              Prompt.make([
                {
                  role: "assistant",
                  content: [Prompt.textPart({ text: "done" })],
                },
              ]),
            ),
          prompt: () =>
            Effect.succeed(
              Stream.make(Response.makePart("text-delta", { id: "answer", delta: "done" })),
            ),
        } satisfies Agent.Agent),
      ),
  } satisfies Agent.Provider;

  const transport: EventTransport = options.transport ?? {
    send: ({ stream }) =>
      stream.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      ),
  };

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Sandbox.ProviderService, sandboxProvider),
      Effect.provideService(Agent.ProviderService, agentProvider),
      Effect.provide(Layer.succeed(EventTransportService, transport)),
      Effect.provide(
        Layer.mergeAll(NodePlatform.NodeFileSystem.layer, NodePlatform.NodePath.layer),
      ),
    );

  return {
    derivedSnapshots,
    removedSnapshots,
    sandboxes,
    sessions,
    provide,
  };
});

describe("exec schedule", () => {
  it.effect("runs tasks and publishes the expected event stream", () =>
    Effect.gen(function* () {
      const events: Array<Event> = [];
      const testProviders = yield* makeTestProviders(events);

      const result = yield* testProviders.provide(
        Schedule.run(
          {
            trailCount: 2,
            tasks: [Effect.succeed(makeTask("alpha")), Effect.succeed(makeTask("beta"))],
            metrics: null,
            metadata: { name: "schedule-bench", description: "schedule integration test" },
          },
          {
            harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
          },
        ),
      );

      assert.deepStrictEqual(result, { metrics: {}, tasks: {} });
      assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 2);
      assert.strictEqual(yield* Ref.get(testProviders.sessions), 4);
      assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 2);

      const summaries = events.map(eventSummary);
      assert.deepStrictEqual(summaries.slice(0, 2), [
        "init:schedule-bench:alpha,beta",
        "bench:start:schedule-bench",
      ]);
      assert.strictEqual(summaries.at(-1), "bench:stop:schedule-bench");

      assert.deepStrictEqual(
        summaries.filter((summary) => summary.startsWith("task:start:")).sort(),
        ["task:start:alpha", "task:start:beta"],
      );
      assert.deepStrictEqual(
        summaries.filter((summary) => summary.startsWith("task:stop:")).sort(),
        ["task:stop:alpha", "task:stop:beta"],
      );
      assert.deepStrictEqual(summaries.filter((summary) => summary.startsWith("part:")).sort(), [
        "part:alpha:0:text-delta",
        "part:alpha:1:text-delta",
        "part:beta:0:text-delta",
        "part:beta:1:text-delta",
      ]);

      for (const taskName of ["alpha", "beta"]) {
        const startIndex = summaries.indexOf(`task:start:${taskName}`);
        const stopIndex = summaries.indexOf(`task:stop:${taskName}`);
        const partIndices = summaries
          .map((summary, index) => [summary, index] as const)
          .filter(([summary]) => summary.startsWith(`part:${taskName}:`))
          .map(([, index]) => index);

        assert.isAtLeast(startIndex, 0);
        assert.isAtLeast(stopIndex, 0);
        assert.isBelow(startIndex, stopIndex);
        assert.strictEqual(partIndices.length, 2);
        assert.isTrue(partIndices.every((index) => startIndex < index && index < stopIndex));
      }
    }),
  );

  it.effect("provides the resolved task context path to graders", () =>
    Effect.gen(function* () {
      const events: Array<Event> = [];
      const testProviders = yield* makeTestProviders(events);
      let resolvedContext: string | undefined;

      yield* testProviders.provide(
        Schedule.run(
          {
            trailCount: 1,
            tasks: [
              Effect.succeed(
                makeContextTask("alpha", "/workspace/task", (context) => {
                  resolvedContext = context;
                }),
              ),
            ],
            metrics: null,
            metadata: { name: "schedule-bench", description: "schedule integration test" },
          },
          {
            harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
          },
        ),
      );

      assert.strictEqual(resolvedContext, "/workspace/task");
    }),
  );

  it.effect(
    "runs to completion and publishes metric events when metrics are configured",
    () =>
      Effect.gen(function* () {
        const events: Array<Event> = [];
        const testProviders = yield* makeTestProviders(events);
        const metrics = yield* Metric.init<Task.Task>().pipe(
          Metric.withTaskEach("score-each", (grade) => grade.score),
        );

        const result = yield* testProviders.provide(
          Schedule.run(
            {
              trailCount: 130,
              tasks: [Effect.succeed(makeTask("alpha"))],
              metrics,
              metadata: { name: "metrics-blocking-bench", description: "metrics blocking probe" },
            },
            {
              harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
            },
          ),
        );

        assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 1);
        assert.strictEqual(yield* Ref.get(testProviders.sessions), 130);
        assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 1);

        assert.deepStrictEqual(result.tasks["alpha"]?.trails[0]?.grades, { score: 1 });
        assert.deepStrictEqual(result.tasks["alpha"]?.trails[129]?.grades, { score: 1 });
        assert.deepStrictEqual(result.tasks["alpha"]?.metrics, { "score-each": [1] });

        const summaries = events.map(eventSummary);
        assert.strictEqual(
          summaries.filter((summary) => summary === "metric:TaskOutput:score-each").length,
          130,
        );
        assert.include(summaries, "bench:stop:metrics-blocking-bench");
      }),
    10_000,
  );

  it.effect(
    "drains metric events published after the schedule stops before joining the transport",
    () =>
      Effect.gen(function* () {
        const events: Array<Event> = [];
        const benchStopObserved = yield* Deferred.make<void>();
        const metricComputedAfterBenchStop = yield* Deferred.make<void>();
        const releaseTransport = yield* Deferred.make<void>();
        const completed = yield* Ref.make(false);

        const transport: EventTransport = {
          send: ({ stream }) =>
            stream.pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  events.push(event);

                  if (event._tag === "BenchScheduleEvent" && event.op === "stop") {
                    yield* Deferred.succeed(benchStopObserved, void 0);
                    yield* Deferred.await(releaseTransport);
                  }
                }),
              ),
            ),
        };

        const testProviders = yield* makeTestProviders(events, { transport });
        const metrics = yield* Metric.init<Task.Task>().pipe(
          Metric.withTaskEach("after-stop-score", async (grade) => {
            await Effect.runPromise(Deferred.await(benchStopObserved));
            await Effect.runPromise(Deferred.succeed(metricComputedAfterBenchStop, void 0));
            return grade.score;
          }),
        );

        const fiber = yield* testProviders
          .provide(
            Schedule.run(
              {
                trailCount: 1,
                tasks: [Effect.succeed(makeTask("alpha"))],
                metrics,
                metadata: {
                  name: "queue-termination-bench",
                  description: "queue termination ordering",
                },
              },
              {
                harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
              },
            ).pipe(Effect.tap(() => Ref.set(completed, true))),
          )
          .pipe(Effect.forkScoped);

        yield* Deferred.await(benchStopObserved);
        yield* Deferred.await(metricComputedAfterBenchStop);
        yield* Effect.yieldNow;

        assert.isFalse(yield* Ref.get(completed));

        yield* Deferred.succeed(releaseTransport, void 0);
        const result = yield* Fiber.join(fiber);

        assert.deepStrictEqual(result.tasks["alpha"]?.metrics, { "after-stop-score": [1] });

        const summaries = events.map(eventSummary);
        const benchStopIndex = summaries.indexOf("bench:stop:queue-termination-bench");
        const metricIndex = summaries.indexOf("metric:TaskOutput:after-stop-score");

        assert.isAtLeast(benchStopIndex, 0);
        assert.isAtLeast(metricIndex, 0);
        assert.isBelow(benchStopIndex, metricIndex);
        assert.strictEqual(yield* Ref.get(completed), true);
      }),
    10_000,
  );

  it.effect("fails with InitError when trailCount is zero", () =>
    Effect.gen(function* () {
      const events: Array<Event> = [];
      const testProviders = yield* makeTestProviders(events);

      const error = yield* testProviders
        .provide(
          Schedule.run(
            {
              trailCount: 0,
              tasks: [Effect.succeed(makeTask("alpha"))],
              metrics: null,
              metadata: { name: "zero-trails-bench", description: "invalid trail count" },
            },
            {
              harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
            },
          ),
        )
        .pipe(Effect.flip);

      assert.instanceOf(error, ExecError);
      assert.strictEqual(error.reason._tag, "InitError");
      assert.deepStrictEqual(events, []);
      assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 0);
      assert.strictEqual(yield* Ref.get(testProviders.sandboxes), 0);
      assert.strictEqual(yield* Ref.get(testProviders.sessions), 0);
      assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 0);
    }),
  );

  it.effect("fails before publishing schedule events when a task cannot load", () =>
    Effect.gen(function* () {
      const events: Array<Event> = [];
      const testProviders = yield* makeTestProviders(events);

      const error = yield* testProviders
        .provide(
          Schedule.run(
            {
              trailCount: 1,
              tasks: [Effect.fail(Task.TaskError.load(new Error("load failed")))],
              metrics: null,
              metadata: { name: "task-load-failure-bench", description: "load failure" },
            },
            {
              harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
            },
          ),
        )
        .pipe(Effect.flip);

      assert.instanceOf(error, ExecError);
      assert.strictEqual(error.reason._tag, "TaskLoadError");
      assert.deepStrictEqual(events, []);
      assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 0);
      assert.strictEqual(yield* Ref.get(testProviders.sandboxes), 0);
      assert.strictEqual(yield* Ref.get(testProviders.sessions), 0);
      assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 0);
    }),
  );

  it.effect(
    "reports snapshot preparation failures as task init errors without starting the task",
    () =>
      Effect.gen(function* () {
        const events: Array<Event> = [];
        const testProviders = yield* makeTestProviders(events, { failAgentDeriveSnapshot: true });

        const error = yield* testProviders
          .provide(
            Schedule.run(
              {
                trailCount: 1,
                tasks: [Effect.succeed(makeTask("alpha"))],
                metrics: null,
                metadata: { name: "snapshot-failure-bench", description: "snapshot failure" },
              },
              {
                harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
              },
            ),
          )
          .pipe(Effect.flip);

        assert.instanceOf(error, ExecError);
        assert.strictEqual(error.reason._tag, "TaskInitError");
        assert.deepStrictEqual(events.map(eventSummary), [
          "init:snapshot-failure-bench:alpha",
          "bench:start:snapshot-failure-bench",
        ]);
        assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 1);
        assert.strictEqual(yield* Ref.get(testProviders.sandboxes), 0);
        assert.strictEqual(yield* Ref.get(testProviders.sessions), 0);
        assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 0);
      }),
  );

  it.effect(
    "reports trail execution failures as task exec errors and removes derived snapshots",
    () =>
      Effect.gen(function* () {
        const events: Array<Event> = [];
        const testProviders = yield* makeTestProviders(events, { failRunSandbox: true });

        const error = yield* testProviders
          .provide(
            Schedule.run(
              {
                trailCount: 1,
                tasks: [Effect.succeed(makeTask("alpha"))],
                metrics: null,
                metadata: { name: "sandbox-failure-bench", description: "sandbox failure" },
              },
              {
                harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
              },
            ),
          )
          .pipe(Effect.flip);

        assert.instanceOf(error, ExecError);
        assert.strictEqual(error.reason._tag, "TaskExecError");
        if (error.reason._tag === "TaskExecError") {
          assert.strictEqual(error.reason.trailIndex, 0);
        }
        assert.deepStrictEqual(events.map(eventSummary), [
          "init:sandbox-failure-bench:alpha",
          "bench:start:sandbox-failure-bench",
          "task:start:alpha",
        ]);
        assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 1);
        assert.strictEqual(yield* Ref.get(testProviders.sandboxes), 1);
        assert.strictEqual(yield* Ref.get(testProviders.sessions), 0);
        assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 1);
      }),
  );

  it.effect("keeps derived snapshots when snapshot caching is enabled", () =>
    Effect.gen(function* () {
      const events: Array<Event> = [];
      const testProviders = yield* makeTestProviders(events);

      const result = yield* testProviders.provide(
        Schedule.run(
          {
            trailCount: 1,
            tasks: [Effect.succeed(makeTask("alpha"))],
            metrics: null,
            metadata: { name: "cached-snapshot-bench", description: "cached snapshot" },
          },
          {
            harnessConfig: { snapshotConcurrency: 1, trailConcurrency: 1 },
            sandboxConfig: { cacheSnapshot: true },
          },
        ),
      );

      assert.deepStrictEqual(result, { metrics: {}, tasks: {} });
      assert.strictEqual(yield* Ref.get(testProviders.derivedSnapshots), 1);
      assert.strictEqual(yield* Ref.get(testProviders.sandboxes), 1);
      assert.strictEqual(yield* Ref.get(testProviders.sessions), 1);
      assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 0);
      assert.include(events.map(eventSummary), "bench:stop:cached-snapshot-bench");
    }),
  );
});
