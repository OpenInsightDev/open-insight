import { NodeServices } from "@effect/platform-node";
import { assert, beforeEach, describe, layer } from "@effect/vitest";
import { Agent, Sandbox, Snapshot } from "@open-insight/core";
import { Effect, Layer, Option } from "effect";
import { Prompt } from "effect/unstable/ai";
import { vi } from "vite-plus/test";
import * as Bench from "../bench/index.ts";
import * as Task from "../task/index.ts";
import { run } from "./schedule.ts";

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

vi.mock("./trail.ts", async () => {
  const { Effect } = await import("effect");

  return {
    createTrail: vi.fn(({ task }: { task: { readonly name: string } }) =>
      Effect.sync(() => {
        let nextTrailIndex = 0;

        return Effect.gen(function* () {
          mockState.starts.push({
            task: task.name,
            trailIndex: nextTrailIndex,
          });
          nextTrailIndex += 1;

          yield* Effect.yieldNow;
        });
      }),
    ),
  };
});

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
  });

  layer(TestLayer)((it) => {
    it.effect("keeps trail starts fair by task when trail concurrency is contended", () =>
      Effect.gen(function* () {
        const taskNames = ["task-a", "task-b", "task-c", "task-d"];
        const trailCount = 3;
        const benchmark = yield* Bench.make({
          name: "fair-schedule",
          tasks: taskNames.map(makeTask),
        });

        yield* run(
          {
            trailCount,
            metrics: Option.none(),
            benchmark,
          },
          {
            trailConcurrency: 2,
          },
        ).pipe(Effect.timeout("5 seconds"));

        assert.strictEqual(mockState.starts.length, taskNames.length * trailCount);
        assertFairWaves(mockState.starts, taskNames);
      }),
    );
  });
});
