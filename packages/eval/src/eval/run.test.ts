import { assert, beforeEach, describe, it } from "@effect/vitest";
import { Agent, Sandbox } from "@open-insight/core";
import { Effect, Layer, Option, Queue, Stream } from "effect";
import { vi } from "vite-plus/test";
import * as Bench from "../bench/index.ts";
import * as Harness from "../harness/index.ts";
import * as Metric from "../metric/index.ts";
import type { Event } from "./event/index.ts";
import { BenchScheduleEvent, EventTransportService, type EventTransport } from "./event/index.ts";
import { Error } from "./error.ts";
import { make } from "./build.ts";
import { run, runMatrix } from "./run.ts";
import { run as runSchedule } from "./schedule.ts";

vi.mock("./schedule.ts", { spy: true });

type ScheduleCall = Readonly<{
  id: string;
  metricsEnabled: boolean;
  trailCount: number;
}>;

type MockState = {
  active: number;
  calls: Array<ScheduleCall>;
  fail: string | null;
  maxActive: number;
  neverComplete: boolean;
  releaseAt: number;
  released: boolean;
};

const mockState = vi.hoisted<MockState>(() => ({
  active: 0,
  calls: [],
  fail: null,
  maxActive: 0,
  neverComplete: false,
  releaseAt: 0,
  released: false,
}));

const installScheduleMock = () => {
  vi.mocked(runSchedule).mockImplementation(
    ({ bench: benchmark, eventQueue, harness, metrics, trailCount }) => {
      const id = `${benchmark.name}/${harness.base.id}`;

      return Effect.gen(function* () {
        mockState.calls.push({
          id,
          metricsEnabled: Option.isSome(metrics),
          trailCount,
        });
        mockState.active += 1;
        mockState.maxActive = Math.max(mockState.maxActive, mockState.active);

        yield* Queue.offer(
          eventQueue,
          BenchScheduleEvent.make({
            bench: benchmark.name,
            harness: harness.base.id,
            op: "start",
          }),
        );

        if (mockState.releaseAt > 0) {
          if (mockState.active >= mockState.releaseAt) {
            mockState.released = true;
          }
          while (!mockState.released) {
            yield* Effect.yieldNow;
          }
        }

        if (mockState.fail === id) {
          return yield* Effect.fail(Error.init(new globalThis.Error(`Evaluation failed: ${id}`)));
        }
        if (mockState.neverComplete) {
          return yield* Effect.never;
        }

        return {
          metrics: { id },
          tasks: {},
        };
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            mockState.active -= 1;
          }),
        ),
      );
    },
  );
};

const unusedAgentProvider: Agent.Provider = {
  snapshotExtension: Option.none(),
  runSession: () => Effect.die("agent provider should not be used by run test"),
};

const unusedSandboxProvider: Sandbox.Provider = {
  aquireSnapshot: () => Effect.die("sandbox provider should not be used by run test"),
  deriveSnapshot: () => Effect.die("sandbox provider should not be used by run test"),
  runSandbox: () => Effect.die("sandbox provider should not be used by run test"),
};

const makeHarness = (id: string) =>
  ({
    metadata: new Harness.BaseMetadata({ id }),
    config: {},
    layer: Layer.mergeAll(
      Layer.succeed(Agent.ProviderService)(unusedAgentProvider),
      Layer.succeed(Sandbox.ProviderService)(unusedSandboxProvider),
    ),
  }) satisfies Harness.Harness;

const makeBenchmark = (name: string) => Bench.make({ name, tasks: [] });

describe("runMatrix", () => {
  beforeEach(() => {
    mockState.active = 0;
    mockState.calls = [];
    mockState.fail = null;
    mockState.maxActive = 0;
    mockState.neverComplete = false;
    mockState.releaseAt = 0;
    mockState.released = false;
    installScheduleMock();
  });

  it.effect("runs the cartesian product in stable result order through one transport", () =>
    Effect.gen(function* () {
      const benchmarkA = yield* makeBenchmark("bench-a");
      const benchmarkB = yield* makeBenchmark("bench-b");
      const harnesses = [
        makeHarness("harness-a"),
        makeHarness("harness-b"),
        makeHarness("harness-c"),
      ];
      const metrics = yield* Metric.init();
      const events: Array<Event> = [];
      let sendCount = 0;
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

      const results = yield* runMatrix({
        benchmarks: [{ benchmark: benchmarkA, metrics, trailCount: 2 }, { benchmark: benchmarkB }],
        harnesses,
      }).pipe(Effect.provideService(EventTransportService, transport));

      const expectedOrder = [
        "bench-a/harness-a",
        "bench-a/harness-b",
        "bench-a/harness-c",
        "bench-b/harness-a",
        "bench-b/harness-b",
        "bench-b/harness-c",
      ];

      assert.deepStrictEqual(
        results.map((row) => row.map(({ metrics }) => metrics.id)),
        [expectedOrder.slice(0, 3), expectedOrder.slice(3)],
      );
      assert.deepStrictEqual(
        mockState.calls.map(({ id }) => id),
        expectedOrder,
      );
      assert.deepStrictEqual(
        mockState.calls.map(({ trailCount }) => trailCount),
        [2, 2, 2, 1, 1, 1],
      );
      assert.deepStrictEqual(
        mockState.calls.map(({ metricsEnabled }) => metricsEnabled),
        [true, true, true, false, false, false],
      );
      assert.strictEqual(sendCount, 1);
      assert.deepStrictEqual(
        events.map((event) => {
          const bench = typeof event.bench === "string" ? event.bench : event.bench.name;
          const harness = typeof event.harness === "string" ? event.harness : event.harness.name;
          return `${bench}/${harness}`;
        }),
        expectedOrder,
      );
    }),
  );

  it.effect("defaults to one combination and respects configured concurrency", () =>
    Effect.gen(function* () {
      const benchmarks = [
        { benchmark: yield* makeBenchmark("bench-a") },
        { benchmark: yield* makeBenchmark("bench-b") },
      ];
      const harnesses = [makeHarness("harness-a"), makeHarness("harness-b")];

      yield* runMatrix({ benchmarks, harnesses });
      assert.strictEqual(mockState.maxActive, 1);

      mockState.calls = [];
      mockState.maxActive = 0;
      mockState.releaseAt = 2;
      mockState.released = false;

      yield* runMatrix({ benchmarks, harnesses }, { concurrency: 2 });
      assert.strictEqual(mockState.maxActive, 2);
      assert.strictEqual(mockState.calls.length, 4);
    }),
  );

  it.effect("interrupts other combinations and annotates evaluation errors", () =>
    Effect.gen(function* () {
      const benchmark = yield* makeBenchmark("bench-a");
      const harnessA = makeHarness("harness-a");
      const harnessB = makeHarness("harness-b");
      const events: Array<Event> = [];
      mockState.fail = "bench-a/harness-a";
      mockState.neverComplete = true;
      mockState.releaseAt = 2;
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

      const error = yield* runMatrix(
        {
          benchmarks: [{ benchmark }],
          harnesses: [harnessA, harnessB],
        },
        { concurrency: 2 },
      ).pipe(Effect.provideService(EventTransportService, transport), Effect.flip);

      assert.strictEqual(error.reason._tag, "InitError");
      assert.strictEqual(error.benchmark?.name, "bench-a");
        assert.strictEqual(error.harness?.base.id, "harness-a");
      assert.strictEqual(mockState.active, 0);
      assert.strictEqual(events.length, 2);
    }),
  );

  it.effect("interrupts all evaluations when the transport fails", () =>
    Effect.gen(function* () {
      const benchmark = yield* makeBenchmark("bench-a");
      const harnesses = [makeHarness("harness-a"), makeHarness("harness-b")];
      const transportError = Error.eventTransport("test")(new globalThis.Error("transport failed"));
      let sendCount = 0;
      mockState.neverComplete = true;

      const transport: EventTransport = {
        send: ({ stream }) =>
          Effect.sync(() => {
            sendCount += 1;
          }).pipe(
            Effect.andThen(stream.pipe(Stream.runHead)),
            Effect.andThen(Effect.fail(transportError)),
          ),
      };

      const error = yield* runMatrix(
        {
          benchmarks: [{ benchmark }],
          harnesses,
        },
        { concurrency: 2 },
      ).pipe(Effect.provideService(EventTransportService, transport), Effect.flip);

      assert.strictEqual(error.reason._tag, "EventTransportError");
      assert.isUndefined(error.benchmark);
      assert.isUndefined(error.harness);
      assert.strictEqual(sendCount, 1);
      assert.strictEqual(mockState.active, 0);
    }),
  );

  it.effect("validates unique names and skips transport for empty inputs", () =>
    Effect.gen(function* () {
      const benchmarkA = yield* makeBenchmark("bench-a");
      const benchmarkB = yield* makeBenchmark("bench-b");
      const harnessA = makeHarness("harness-a");
      const harnessB = makeHarness("harness-b");
      let sendCount = 0;
      const transport: EventTransport = {
        send: ({ stream }) =>
          Effect.sync(() => {
            sendCount += 1;
          }).pipe(Effect.andThen(stream.pipe(Stream.runDrain))),
      };
      const provideTransport = Effect.provideService(EventTransportService, transport);

      const noBenchmarks = yield* runMatrix({ benchmarks: [], harnesses: [harnessA] }).pipe(
        provideTransport,
      );
      const noHarnesses = yield* runMatrix({
        benchmarks: [{ benchmark: benchmarkA }, { benchmark: benchmarkB }],
        harnesses: [],
      }).pipe(provideTransport);

      assert.deepStrictEqual(noBenchmarks, []);
      assert.deepStrictEqual(noHarnesses, [[], []]);
      assert.strictEqual(sendCount, 0);

      const benchmarkError = yield* runMatrix({
        benchmarks: [{ benchmark: benchmarkA }, { benchmark: benchmarkA }],
        harnesses: [harnessA],
      }).pipe(provideTransport, Effect.flip);
      const harnessError = yield* runMatrix({
        benchmarks: [{ benchmark: benchmarkA }],
          harnesses: [harnessA, makeHarness(harnessA.metadata.id), harnessB],
      }).pipe(provideTransport, Effect.flip);

      assert.strictEqual(benchmarkError.reason._tag, "InitError");
      assert.isUndefined(benchmarkError.benchmark);
      assert.isUndefined(benchmarkError.harness);
      assert.strictEqual(harnessError.reason._tag, "InitError");
      assert.isUndefined(harnessError.benchmark);
      assert.isUndefined(harnessError.harness);
      assert.strictEqual(sendCount, 0);
    }),
  );
});

describe("run", () => {
  beforeEach(() => {
    mockState.active = 0;
    mockState.calls = [];
    mockState.fail = null;
    mockState.maxActive = 0;
    mockState.neverComplete = false;
    mockState.releaseAt = 0;
    mockState.released = false;
    installScheduleMock();
  });

  it.effect("reads the transport at run time and preserves single-eval behavior", () =>
    Effect.gen(function* () {
      const benchmark = yield* makeBenchmark("bench-a");
      const harness = makeHarness("harness-a");
      const executor = yield* make({ benchmark, harness });
      const events: Array<Event> = [];
      let sendCount = 0;
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

      const result = yield* run(executor).pipe(
        Effect.provideService(EventTransportService, transport),
      );

      assert.strictEqual(result.metrics.id, "bench-a/harness-a");
      assert.strictEqual(sendCount, 1);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0]?.harness, "harness-a");
    }),
  );
});
