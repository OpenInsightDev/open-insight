import { assert, describe, it } from "@effect/vitest";
import { Agent, Sandbox } from "@open-insight/core/internal";
import { Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { Prompt } from "effect/unstable/ai";
import { vi } from "vite-plus/test";
import * as Task from "../task/index.ts";
import type { Executor } from "./build.ts";
import { ExecError } from "./error.ts";
import { run } from "./schedule.ts";

type Event =
  | `snapshot:start:${string}`
  | `snapshot:end:${string}`
  | `trail:start:${string}`
  | `trail:end:${string}`
  | `remove:${string}`;

type Probe = Readonly<{
  events: Ref.Ref<Array<Event>>;
  activeSnapshots: Ref.Ref<number>;
  maxActiveSnapshots: Ref.Ref<number>;
  activeTrails: Ref.Ref<number>;
  maxActiveTrails: Ref.Ref<number>;
}>;

type MockState = Readonly<{
  probe: Probe;
  snapshotDelay: (taskName: string) => Effect.Effect<void>;
  trailDelay: (taskName: string) => Effect.Effect<void>;
  failSnapshotFor?: string;
  failTrailFor?: string;
}>;

const mockState = vi.hoisted(() => ({
  current: undefined as MockState | undefined,
}));

vi.mock("./trail.ts", () => ({
  createTrail: ({ task }: { task: Task.Task }) =>
    Effect.gen(function* () {
      const state = mockState.current;
      if (state === undefined) {
        throw new Error("schedule test mock state is not initialized");
      }

      const { probe, snapshotDelay, trailDelay, failSnapshotFor, failTrailFor } = state;
      const recordEvent = record(probe);
      const taskName = task.metadata.name;

      yield* recordEvent(`snapshot:start:${taskName}`);
      yield* enter(probe.activeSnapshots, probe.maxActiveSnapshots);
      yield* snapshotDelay(taskName);
      yield* leave(probe.activeSnapshots);
      if (failSnapshotFor === taskName) {
        return yield* Effect.fail(
          ExecError.taskInit({ task: task.metadata })(`snapshot failed for ${taskName}`),
        );
      }
      yield* recordEvent(`snapshot:end:${taskName}`);

      return Effect.gen(function* () {
        yield* recordEvent(`trail:start:${taskName}`);
        yield* enter(probe.activeTrails, probe.maxActiveTrails);
        yield* trailDelay(taskName);
        yield* leave(probe.activeTrails);
        if (failTrailFor === taskName) {
          return yield* Effect.fail(
            ExecError.taskExec({ task: task.metadata, trailIndex: 0 })(
              `trail failed for ${taskName}`,
            ),
          );
        }
        yield* recordEvent(`trail:end:${taskName}`);
      });
    }),
}));

const prompt = [
  Prompt.makeMessage("user", {
    content: [Prompt.makePart("text", { text: "Run the evaluation task." })],
  }),
];

const snapshotFor = (name: string) =>
  Sandbox.Snapshot.Snapshot.make({
    image: `test/${name}:latest`,
    instructions: [],
  });

const makeProbe = Effect.gen(function* () {
  const events = yield* Ref.make<Array<Event>>([]);
  const activeSnapshots = yield* Ref.make(0);
  const maxActiveSnapshots = yield* Ref.make(0);
  const activeTrails = yield* Ref.make(0);
  const maxActiveTrails = yield* Ref.make(0);

  return {
    events,
    activeSnapshots,
    maxActiveSnapshots,
    activeTrails,
    maxActiveTrails,
  } satisfies Probe;
});

const record =
  (probe: Probe) =>
  (event: Event): Effect.Effect<void> =>
    Ref.update(probe.events, (events) => [...events, event]);

const enter = (active: Ref.Ref<number>, maximum: Ref.Ref<number>): Effect.Effect<void> =>
  Ref.updateAndGet(active, (n) => n + 1).pipe(
    Effect.flatMap((current) => Ref.update(maximum, (max) => Math.max(max, current))),
  );

const leave = (active: Ref.Ref<number>): Effect.Effect<void> => Ref.update(active, (n) => n - 1);

const makeTask = (name: string): Task.Task => ({
  metadata: { name },
  prompt,
  snapshot: snapshotFor(name),
  context: Sandbox.Context.makeDir("/tmp/open-insight-schedule-test"),
  resources: null,
  graders: {
    ok: () => Promise.resolve(name),
  },
});

const makeExecutor = ({
  taskNames,
  trailCount,
}: {
  taskNames: ReadonlyArray<string>;
  trailCount: number;
}): Effect.Effect<Executor> =>
  Effect.sync(() => {
    const tasks = taskNames.map((name) => Effect.succeed(makeTask(name)));

    const sandboxProvider: Sandbox.Provider = {
      ensureSnapshot: () => Effect.void,
      deriveSnapshot: () => Effect.void,
      removeSnapshot: () => Effect.void,
      runSandbox: () => Effect.die("schedule tests mock createTrail before runSandbox"),
    };

    const agentProvider: Agent.Provider = {
      deriveSnapshot: ({ snapshot }) => Effect.succeed(snapshot),
      runSession: () => Effect.die("schedule tests mock createTrail before runSession"),
    };

    return {
      benchmark: {
        tasks,
        metadata: {
          name: "schedule-test",
          description: "Schedule behavior test",
        },
      },
      harness: {
        sandbox: Layer.succeed(Sandbox.ProviderService, sandboxProvider),
        agent: Layer.succeed(Agent.ProviderService, agentProvider),
      },
      trailCount,
      metrics: null,
      transport: null,
    };
  });

const makeSchedule = ({
  probe,
  snapshotDelay = () => Effect.void,
  trailDelay = () => Effect.void,
  failSnapshotFor,
  failTrailFor,
}: {
  probe: Probe;
  snapshotDelay?: (taskName: string) => Effect.Effect<void>;
  trailDelay?: (taskName: string) => Effect.Effect<void>;
  failSnapshotFor?: string;
  failTrailFor?: string;
}) => {
  mockState.current = {
    probe,
    snapshotDelay,
    trailDelay,
    failSnapshotFor,
    failTrailFor,
  };

  return run;
};

const eventCount = (events: ReadonlyArray<Event>, prefix: string) =>
  events.filter((event) => event.startsWith(prefix)).length;

const trailEndCountFor = (events: ReadonlyArray<Event>, taskName: string) =>
  events.filter((event) => event === `trail:end:${taskName}`).length;

describe("exec schedule", () => {
  it.effect("waits for every task snapshot before starting any trail", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta", "gamma"],
        trailCount: 1,
      });
      const run = makeSchedule({ probe });

      yield* run({ executor, config: {} });

      const events = yield* Ref.get(probe.events);
      const firstTrailIndex = events.findIndex((event) => event.startsWith("trail:start:"));
      const lastSnapshotIndex = Math.max(
        ...["alpha", "beta", "gamma"].map((name) => events.indexOf(`snapshot:end:${name}`)),
      );

      assert.isAtLeast(firstTrailIndex, 0);
      assert.isAbove(firstTrailIndex, lastSnapshotIndex);
      assert.strictEqual(eventCount(events, "trail:end:"), 3);
    }),
  );

  it.effect(
    "keeps every trail behind the snapshot barrier while one snapshot is still pending",
    () =>
      Effect.gen(function* () {
        const probe = yield* makeProbe;
        const gammaStarted = yield* Deferred.make<void>();
        const releaseGamma = yield* Deferred.make<void>();
        const executor = yield* makeExecutor({
          taskNames: ["alpha", "beta", "gamma"],
          trailCount: 1,
        });
        const run = makeSchedule({
          probe,
          snapshotDelay: (taskName) =>
            taskName === "gamma"
              ? Deferred.succeed(gammaStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseGamma)),
                )
              : Effect.void,
        });

        const fiber = yield* Effect.forkChild(
          run({
            executor,
            config: { harnessConfig: { snapshotConcurrency: 3, trailConcurrency: 3 } },
          }),
        );

        yield* Deferred.await(gammaStarted);
        yield* Effect.yieldNow;

        const blockedEvents = yield* Ref.get(probe.events);
        assert.strictEqual(eventCount(blockedEvents, "trail:start:"), 0);

        yield* Deferred.succeed(releaseGamma, undefined);
        yield* Fiber.join(fiber);

        const completedEvents = yield* Ref.get(probe.events);
        assert.strictEqual(eventCount(completedEvents, "trail:end:"), 3);
      }),
  );

  it.effect("limits snapshot creation with snapshotConcurrency", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta", "gamma", "delta"],
        trailCount: 1,
      });
      const run = makeSchedule({ probe, snapshotDelay: () => Effect.yieldNow });

      yield* run({
        executor,
        config: { harnessConfig: { snapshotConcurrency: 2, trailConcurrency: 4 } },
      });

      const maxActiveSnapshots = yield* Ref.get(probe.maxActiveSnapshots);
      assert.strictEqual(maxActiveSnapshots, 2);
    }),
  );

  it.effect(
    "does not admit more snapshots than snapshotConcurrency while snapshots are blocked",
    () =>
      Effect.gen(function* () {
        const probe = yield* makeProbe;
        const releaseSnapshots = yield* Deferred.make<void>();
        const executor = yield* makeExecutor({
          taskNames: ["alpha", "beta", "gamma"],
          trailCount: 0,
        });
        const run = makeSchedule({
          probe,
          snapshotDelay: () => Deferred.await(releaseSnapshots),
        });

        const fiber = yield* Effect.forkChild(
          run({
            executor,
            config: { harnessConfig: { snapshotConcurrency: 2, trailConcurrency: 1 } },
          }),
        );

        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        const blockedEvents = yield* Ref.get(probe.events);
        assert.strictEqual(eventCount(blockedEvents, "snapshot:start:"), 2);
        assert.strictEqual(eventCount(blockedEvents, "snapshot:end:"), 0);

        yield* Deferred.succeed(releaseSnapshots, undefined);
        yield* Fiber.join(fiber);

        const completedEvents = yield* Ref.get(probe.events);
        assert.strictEqual(eventCount(completedEvents, "snapshot:end:"), 3);
      }),
  );

  it.effect("limits sandbox trail execution with trailConcurrency", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta", "gamma"],
        trailCount: 3,
      });
      const run = makeSchedule({ probe, trailDelay: () => Effect.yieldNow });

      yield* run({
        executor,
        config: { harnessConfig: { snapshotConcurrency: 3, trailConcurrency: 2 } },
      });

      const maxActiveTrails = yield* Ref.get(probe.maxActiveTrails);
      const events = yield* Ref.get(probe.events);

      assert.strictEqual(maxActiveTrails, 2);
      assert.strictEqual(trailEndCountFor(events, "alpha"), 3);
      assert.strictEqual(trailEndCountFor(events, "beta"), 3);
      assert.strictEqual(trailEndCountFor(events, "gamma"), 3);
    }),
  );

  it.effect("does not admit more trails than trailConcurrency while trails are blocked", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const releaseTrails = yield* Deferred.make<void>();
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta"],
        trailCount: 2,
      });
      const run = makeSchedule({
        probe,
        trailDelay: () => Deferred.await(releaseTrails),
      });

      const fiber = yield* Effect.forkChild(
        run({
          executor,
          config: { harnessConfig: { snapshotConcurrency: 2, trailConcurrency: 2 } },
        }),
      );

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const blockedEvents = yield* Ref.get(probe.events);
      assert.strictEqual(eventCount(blockedEvents, "trail:start:"), 2);
      assert.strictEqual(eventCount(blockedEvents, "trail:end:"), 0);

      yield* Deferred.succeed(releaseTrails, undefined);
      yield* Fiber.join(fiber);

      const completedEvents = yield* Ref.get(probe.events);
      assert.strictEqual(eventCount(completedEvents, "trail:end:"), 4);
    }),
  );

  it.effect("does not start trails when trailCount is zero", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta"],
        trailCount: 0,
      });
      const run = makeSchedule({ probe });

      yield* run({ executor, config: {} });

      const events = yield* Ref.get(probe.events);
      assert.strictEqual(eventCount(events, "snapshot:end:"), 2);
      assert.strictEqual(eventCount(events, "trail:start:"), 0);
    }),
  );

  it.effect("does not start trails when any task snapshot fails", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta", "gamma"],
        trailCount: 2,
      });
      const run = makeSchedule({ probe, failSnapshotFor: "beta" });

      yield* run({ executor, config: {} }).pipe(Effect.flip);

      const events = yield* Ref.get(probe.events);

      assert.strictEqual(events.filter((event) => event.startsWith("trail:start:")).length, 0);
    }),
  );

  it.effect("fails the schedule when any trail fails", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbe;
      const executor = yield* makeExecutor({
        taskNames: ["alpha", "beta"],
        trailCount: 1,
      });
      const run = makeSchedule({ probe, failTrailFor: "beta" });

      yield* run({ executor, config: {} }).pipe(Effect.flip);
    }),
  );
});
