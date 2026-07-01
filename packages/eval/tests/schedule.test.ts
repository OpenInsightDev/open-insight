import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import { Agent, Sandbox } from "@open-insight/core/internal";
import * as Schedule from "@/exec/schedule.ts";
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
  context: Sandbox.Context.Cwd,
  resources: null,
});

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

const makeTestProviders = Effect.fn(function* (events: Array<Event>) {
  const derivedSnapshots = yield* Ref.make(0);
  const removedSnapshots = yield* Ref.make(0);
  const sessions = yield* Ref.make(0);

  const sandboxProvider = {
    ensureSnapshot: () => Effect.void,
    deriveSnapshot: () => Effect.void,
    removeSnapshot: () => Ref.update(removedSnapshots, (count) => count + 1),
    runSandbox: () => Effect.succeed(makeSandbox()),
  } satisfies Sandbox.Provider;

  const agentProvider = {
    deriveSnapshot: ({ snapshot }) =>
      Ref.update(derivedSnapshots, (count) => count + 1).pipe(Effect.as(snapshot)),
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

  const transport: EventTransport = {
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
    );

  return {
    derivedSnapshots,
    removedSnapshots,
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

  it.effect("runs to completion and publishes metric events when metrics are configured", () =>
    Effect.gen(function* () {
      const events: Array<Event> = [];
      const testProviders = yield* makeTestProviders(events);
      const metrics = yield* Metric.init<Task.Task>().pipe(
        Metric.withTask("grade-count", (grades) => grades.length),
      );

      const result = yield* testProviders.provide(
        Schedule.run(
          {
            trailCount: 1,
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
      assert.strictEqual(yield* Ref.get(testProviders.sessions), 1);
      assert.strictEqual(yield* Ref.get(testProviders.removedSnapshots), 1);

      assert.deepStrictEqual(result.tasks["alpha"]?.trails[0]?.grades, { score: 1 });
      assert.deepStrictEqual(result.tasks["alpha"]?.metrics, { "grade-count": [1] });

      const summaries = events.map(eventSummary);
      assert.deepStrictEqual(
        summaries.filter((summary) => summary.startsWith("metric:")),
        ["metric:TaskOutput:grade-count"],
      );
      assert.include(summaries, "bench:stop:metrics-blocking-bench");
    }),
  );
});
