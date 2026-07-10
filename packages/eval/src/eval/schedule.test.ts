import { NodeServices } from "@effect/platform-node";
import { assert, beforeEach, describe, it } from "@effect/vitest";
import { Agent, Sandbox, Snapshot } from "@open-insight/core";
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import { vi } from "vite-plus/test";
import * as Bench from "../bench/index.ts";
import * as Harness from "../harness/index.ts";
import * as Task from "../task/index.ts";
import {
  EventTransportService,
  TaskStreamPartEvent,
  type Event,
  type EventTransport,
} from "./event/index.ts";
import { runMatrix } from "./run.ts";
import { run } from "./schedule.ts";
import { createTrail } from "./trail.ts";

vi.mock("./trail.ts", { spy: true });

type TrailStart = Readonly<{
  task: string;
  trailIndex: number;
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
  vi.mocked(createTrail).mockImplementation(({ task, bench: benchmark, harness, eventQueue }) =>
    Effect.sync(() => {
      let nextTrailIndex = 0;

      return Effect.gen(function* () {
        const trailIndex = nextTrailIndex;
        mockState.starts.push({
          task: task.name,
          trailIndex,
        });
        nextTrailIndex += 1;

        yield* Queue.offer(
          eventQueue,
          TaskStreamPartEvent.make({
            bench: benchmark,
            harness,
            task: task.name,
            trailIndex,
            parts: [Response.makePart("text-start", { id: "test" })],
          }),
        );
        yield* Effect.yieldNow;
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

const makeTask = (name: string) =>
  Effect.succeed(
    new Task.Task<Record<string, never>, never>({
      name,
      prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: name })] })],
      grader: async (): Promise<Record<string, never>> => ({}),
      snapshot: Snapshot.make({ image: "scratch" }),
    }),
  );

const assertFairWaves = (starts: ReadonlyArray<TrailStart>, taskNames: ReadonlyArray<string>) => {
  for (let offset = 0; offset < starts.length; offset += taskNames.length) {
    const wave = starts.slice(offset, offset + taskNames.length);

    assert.strictEqual(wave.length, taskNames.length);
    assert.sameMembers(
      wave.map((start) => start.task),
      [...taskNames],
    );

    for (const start of wave) {
      assert.strictEqual(start.trailIndex, offset / taskNames.length);
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
      const taskNames = ["task-a", "task-b", "task-c", "task-d"];
      const trailCount = 3;
      const benchmark = yield* Bench.make({
        name: "fair-schedule",
        tasks: taskNames.map(makeTask),
      });
      const eventQueue = yield* Queue.unbounded<Event, Cause.Done>();

      yield* run(
        {
          trailCount,
          metrics: Option.none(),
          bench: benchmark,
          harness: new Harness.Metadata({ name: "test-harness", description: null }),
          eventQueue,
        },
        {
          trailConcurrency: 2,
        },
      ).pipe(Effect.timeout("5 seconds"));

      assert.strictEqual(mockState.starts.length, taskNames.length * trailCount);
      assertFairWaves(mockState.starts, taskNames);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("loads tasks for every combination and tags all shared events", () =>
    Effect.gen(function* () {
      let loadCount = 0;
      let sendCount = 0;
      const events: Array<Event> = [];
      const task = yield* makeTask("task-a");
      const benchmark = yield* Bench.make({
        name: "matrix-bench",
        tasks: [
          Effect.sync(() => {
            loadCount += 1;
            return task;
          }),
        ],
      });
      const harnessA = yield* Harness.make({ name: "harness-a" });
      const harnessB = yield* Harness.make({ name: "harness-b" });
      const transport: EventTransport = {
        send: ({ stream }) =>
          Effect.sync(() => {
            sendCount += 1;
          }).pipe(
            Effect.andThen(
              stream.pipe(
                Stream.runForEach((event) =>
                  Effect.sync(() => {
                    events.push(event);
                  }),
                ),
              ),
            ),
          ),
      };

      const results = yield* runMatrix(
        {
          benchmarks: [{ benchmark }],
          harnesses: [harnessA, harnessB],
        },
        { concurrency: 2 },
      ).pipe(Effect.provideService(EventTransportService, transport));

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.length, 2);
      assert.strictEqual(loadCount, 2);
      assert.strictEqual(sendCount, 1);
      assert.strictEqual(events.length, 12);

      for (const harness of ["harness-a", "harness-b"]) {
        assert.strictEqual(
          events.filter((event) => {
            const eventHarness =
              typeof event.harness === "string" ? event.harness : event.harness.name;
            return eventHarness === harness;
          }).length,
          6,
        );
      }

      let streamEventCount = 0;
      for (const event of events) {
        if (event._tag === "TaskStreamPartEvent") {
          streamEventCount += 1;
          assert.strictEqual(event.bench, "matrix-bench");
          assert.strictEqual(event.task, "task-a");
        }
      }
      assert.strictEqual(streamEventCount, 2);
    }).pipe(Effect.provide(TestLayer)),
  );
});
