import { NodeServices } from "@effect/platform-node";
import { assert, beforeEach, describe, it } from "@effect/vitest";
import { Agent, Sandbox, Snapshot } from "@open-insight/core";
import { Effect, Layer, Option, Queue, Schema, Scope } from "effect";
import { Prompt } from "effect/unstable/ai";
import { vi } from "vite-plus/test";
import * as Bench from "../bench/index.ts";
import * as Harness from "../harness/index.ts";
import * as Task from "../task/index.ts";
import type { Event } from "./event/index.ts";
import { TrailResult } from "./result.ts";
import { run } from "./schedule.ts";
import { createTrail } from "./trail.ts";

vi.mock("./trail.ts", { spy: true });

type TrailStart = Readonly<{
  task: string;
  trailIdx: number;
}>;

type MockState = {
  starts: Array<TrailStart>;
};

const mockState = vi.hoisted(
  (): MockState => ({
    starts: [],
  }),
);

const installTrailMock = () => {
  vi.mocked(createTrail).mockImplementation(({ task }) =>
    Effect.succeed(
      Effect.fn(function* (trailIdx) {
        yield* Scope.Scope;
        mockState.starts.push({
          task: task.metadata.id,
          trailIdx,
        });
        return new TrailResult({ grade: { score: trailIdx }, trajectory: Prompt.empty });
      }),
    ),
  );
};

const unusedAgentProvider: Agent.Provider = {
  snapshotExtension: Option.none(),
  runSession: () => Effect.die("agent provider should not be used by schedule test"),
};

const unusedSandboxProvider: Sandbox.Provider = {
  aquireSnapshot: () => Effect.die("sandbox provider should not be used by schedule test"),
  deriveSnapshot: () => Effect.die("sandbox provider should not be used by schedule test"),
  runSandbox: () => Effect.die("sandbox provider should not be used by schedule test"),
};

const TestLayer = Layer.mergeAll(
  NodeServices.layer,
  Layer.succeed(Agent.ProviderService)(unusedAgentProvider),
  Layer.succeed(Sandbox.ProviderService)(unusedSandboxProvider),
);

const makeTask = (id: string) =>
  Task.make({
    id,
    name: `Task ${id}`,
    snapshot: Snapshot.make({ image: "scratch" }),
  });

const makeHarnessMetadata = (id: string) =>
  new Harness.Metadata({
    id,
    name: `Harness ${id}`,
    description: Option.none(),
  });

const makeBench = Effect.fn(function* (id: string, taskIds: ReadonlyArray<string>) {
  const tasks = yield* Effect.all(taskIds.map(makeTask));
  return yield* Bench.make({ id, subset: false, tasks: Effect.succeed(tasks) });
});

const assertFairWaves = (starts: ReadonlyArray<TrailStart>, taskIds: ReadonlyArray<string>) => {
  for (let offset = 0; offset < starts.length; offset += taskIds.length) {
    const wave = starts.slice(offset, offset + taskIds.length);

    assert.strictEqual(wave.length, taskIds.length);
    assert.sameMembers(
      wave.map((start) => start.task),
      [...taskIds],
    );

    for (const start of wave) {
      assert.strictEqual(start.trailIdx, offset / taskIds.length);
    }
  }
};

describe("run", () => {
  beforeEach(() => {
    mockState.starts = [];
    installTrailMock();
  });

  it.effect("keeps trail starts fair by task when trail concurrency is contended", () =>
    Effect.gen(function* () {
      const taskIds = ["task-a", "task-b", "task-c", "task-d"];
      const trailCount = 3;
      const benchmark = yield* makeBench("fair-schedule", taskIds);
      const eventQueue = yield* Queue.unbounded<Event>();

      yield* run(
        {
          trailCount,
          bench: benchmark,
          harness: makeHarnessMetadata("test-harness"),
          eventQueue,
        },
        { trailConcurrency: 2 },
      ).pipe(Effect.timeout("5 seconds"));

      assert.strictEqual(mockState.starts.length, taskIds.length * trailCount);
      assertFairWaves(mockState.starts, taskIds);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("runs bench metrics with accumulated results and offers bench events", () =>
    Effect.gen(function* () {
      const taskIds = ["task-a", "task-b"];
      const tasks = yield* Effect.all(taskIds.map(makeTask));
      let callCount = 0;
      const benchmark = yield* Bench.make({
        id: "bench-metrics",
        subset: false,
        tasks: Effect.succeed(tasks),
        metrics: [
          {
            id: "completed-trails",
            exec: async (results, delta, prev) => {
              const resultCount = Object.values(results).reduce(
                (count, taskResults) => count + taskResults.length,
                0,
              );
              assert.strictEqual(resultCount, callCount);
              assert.deepStrictEqual(prev, callCount === 0 ? null : { count: callCount });
              assert.include(taskIds, delta.task);
              callCount += 1;
              return { count: callCount };
            },
          },
        ],
      });
      const eventQueue = yield* Queue.unbounded<Event>();

      yield* run(
        {
          trailCount: 2,
          bench: benchmark,
          harness: makeHarnessMetadata("harness-metrics"),
          eventQueue,
        },
        { trailConcurrency: 4 },
      );

      const events = yield* Queue.takeAll(eventQueue);
      const metricEvents = events.filter((event) => event._tag === "BenchMetricEvent");
      assert.strictEqual(callCount, 4);
      assert.deepStrictEqual(
        metricEvents.map(({ bench, harness, id, result }) => ({ bench, harness, id, result })),
        [1, 2, 3, 4].map((count) => ({
          bench: "bench-metrics",
          harness: "harness-metrics",
          id: "completed-trails",
          result: { count },
        })),
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("runs different bench metrics concurrently while preserving each metric's prev", () =>
    Effect.gen(function* () {
      const task = yield* makeTask("task-concurrent-metrics");
      const firstCalls = Promise.withResolvers<void>();
      const calls = { left: 0, right: 0 };
      let arrivals = 0;
      const makeMetric = (id: "left" | "right") => ({
        id,
        exec: async (_results: unknown, _delta: unknown, prev: Schema.JsonObject | null) => {
          assert.deepStrictEqual(prev, calls[id] === 0 ? null : { count: calls[id] });
          calls[id] += 1;

          if (calls[id] === 1) {
            arrivals += 1;
            if (arrivals === 2) {
              firstCalls.resolve();
            }
            await firstCalls.promise;
          }

          return { count: calls[id] };
        },
      });
      const benchmark = yield* Bench.make({
        id: "concurrent-metrics",
        subset: false,
        tasks: Effect.succeed([task]),
        metrics: [makeMetric("left"), makeMetric("right")],
      });
      const eventQueue = yield* Queue.unbounded<Event>();

      yield* run(
        {
          trailCount: 2,
          bench: benchmark,
          harness: makeHarnessMetadata("harness-concurrent-metrics"),
          eventQueue,
        },
        { trailConcurrency: 2 },
      ).pipe(Effect.timeout("5 seconds"));

      assert.deepStrictEqual(calls, { left: 2, right: 2 });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("offers init and balanced schedule events with entity ids", () =>
    Effect.gen(function* () {
      const taskIds = ["task-a", "task-b"];
      const trailCount = 2;
      const benchmark = yield* makeBench("bench-a", taskIds);
      const harness = makeHarnessMetadata("harness-a");
      const eventQueue = yield* Queue.unbounded<Event>();

      yield* run(
        {
          trailCount,
          bench: benchmark,
          harness,
          eventQueue,
        },
        { trailConcurrency: 2 },
      );

      const events = yield* Queue.takeAll(eventQueue);
      const initEvents = events.filter((event) => event._tag === "InitEvent");
      const evalEvents = events.filter((event) => event._tag === "EvalScheduleEvent");
      const taskEvents = events.filter((event) => event._tag === "TaskScheduleEvent");
      const trailEvents = events.filter((event) => event._tag === "TrailScheduleEvent");

      assert.strictEqual(events.length, 15);
      assert.strictEqual(initEvents.length, 1);
      assert.strictEqual(evalEvents.length, 2);
      assert.strictEqual(taskEvents.length, taskIds.length * 2);
      assert.strictEqual(trailEvents.length, taskIds.length * trailCount * 2);

      const init = initEvents[0];
      assert.strictEqual(init?.bench, "bench-a");
      assert.strictEqual(init?.harness, "harness-a");
      assert.strictEqual(init?.benchMetadata.base.id, "bench-a");
      assert.strictEqual(init?.harnessMetadata.id, "harness-a");

      assert.deepStrictEqual(
        evalEvents.map(({ op }) => op),
        ["start", "stop"],
      );

      for (const taskId of taskIds) {
        assert.sameMembers(
          taskEvents.filter(({ task }) => task === taskId).map(({ op }) => op),
          ["start", "stop"],
        );

        for (let trailIdx = 0; trailIdx < trailCount; trailIdx += 1) {
          assert.sameMembers(
            trailEvents
              .filter((event) => event.task === taskId && event.trailIdx === trailIdx)
              .map(({ op }) => op),
            ["start", "stop"],
          );
        }
      }

      for (const event of events) {
        assert.strictEqual(event.bench, "bench-a");
        assert.strictEqual(event.harness, "harness-a");
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("balances schedule events when a trail fails", () =>
    Effect.gen(function* () {
      vi.mocked(createTrail).mockImplementation(() =>
        Effect.succeed((_trailIdx) => Effect.die("expected trail failure")),
      );

      const benchmark = yield* makeBench("bench-failure", ["task-failure"]);
      const eventQueue = yield* Queue.unbounded<Event>();

      const exit = yield* run(
        {
          trailCount: 1,
          bench: benchmark,
          harness: makeHarnessMetadata("harness-failure"),
          eventQueue,
        },
        { trailConcurrency: 1 },
      ).pipe(Effect.exit);

      assert.isTrue(exit._tag === "Failure");

      const events = yield* Queue.takeAll(eventQueue);
      assert.deepStrictEqual(
        events.filter((event) => event._tag === "EvalScheduleEvent").map(({ op }) => op),
        ["start", "stop"],
      );
      assert.deepStrictEqual(
        events.filter((event) => event._tag === "TaskScheduleEvent").map(({ op }) => op),
        ["start", "stop"],
      );
      assert.deepStrictEqual(
        events.filter((event) => event._tag === "TrailScheduleEvent").map(({ op }) => op),
        ["start", "stop"],
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("balances task and eval events when task preparation fails", () =>
    Effect.gen(function* () {
      vi.mocked(createTrail).mockImplementation(() =>
        Effect.die("expected task preparation failure"),
      );

      const benchmark = yield* makeBench("bench-prepare-failure", ["task-prepare-failure"]);
      const eventQueue = yield* Queue.unbounded<Event>();

      const exit = yield* run(
        {
          trailCount: 1,
          bench: benchmark,
          harness: makeHarnessMetadata("harness-prepare-failure"),
          eventQueue,
        },
        {},
      ).pipe(Effect.exit);

      assert.isTrue(exit._tag === "Failure");

      const events = yield* Queue.takeAll(eventQueue);
      assert.deepStrictEqual(
        events.filter((event) => event._tag === "EvalScheduleEvent").map(({ op }) => op),
        ["start", "stop"],
      );
      assert.deepStrictEqual(
        events.filter((event) => event._tag === "TaskScheduleEvent").map(({ op }) => op),
        ["start", "stop"],
      );
      assert.isEmpty(events.filter((event) => event._tag === "TrailScheduleEvent"));
    }).pipe(Effect.provide(TestLayer)),
  );
});
