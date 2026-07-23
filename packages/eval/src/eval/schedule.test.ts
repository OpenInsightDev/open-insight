import { NodeServices } from "@effect/platform-node";
import { assert, beforeEach, describe, it } from "@effect/vitest";
import { Agent, Sandbox, Snapshot } from "@open-insight/core";
import { Effect, Layer, Option, Queue, Scope } from "effect";
import { vi } from "vite-plus/test";
import * as Bench from "../bench/index.ts";
import * as Harness from "../harness/index.ts";
import * as Task from "../task/index.ts";
import type { Event } from "./event/index.ts";
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
    Effect.sync(() => {
      let nextTrailIdx = 0;

      return Effect.gen(function* () {
        yield* Scope.Scope;
        mockState.starts.push({
          task: task.metadata.id,
          trailIdx: nextTrailIdx,
        });
        nextTrailIdx += 1;
        return undefined;
      });
    }),
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
});
