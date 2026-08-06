import { assert, it } from "@effect/vitest";
import { Brand, Effect, Option, Schema, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { Bench, Eval, Event, Grade, Task, Tasks } from "../export.ts";
import { Harness, Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";

const GradeResult = Schema.Struct({ passed: Schema.Boolean });

const finishPart: Response.FinishPartEncoded = {
  type: "finish",
  reason: "stop",
  usage: {
    inputTokens: {
      uncached: 0,
      total: 0,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 0,
      text: undefined,
      reasoning: undefined,
    },
  },
  response: undefined,
};

const fakeHandle = {
  exitCode: ExitCode(0),
  stdout: "",
  stderr: "",
};

const fakeSandbox = {
  spawn: () => Effect.succeed(fakeHandle),
  exitCode: () => Effect.succeed(ExitCode(0)),
  success: () => Effect.void,
  stdout: () => Effect.succeed(""),
  stderr: () => Effect.succeed(""),
  cmd: () => Effect.succeed(fakeHandle),
  readFile: () => Effect.succeed(""),
  writeFile: () => Effect.void,
  download: () => Effect.void,
  upload: () => Effect.void,
  expose: () => Effect.succeed({ hostUrl: "http://localhost" }),
} satisfies Sandbox.Sandbox;

const fakeSnapshotHandle = Brand.nominal<Snapshot.Handle.Handle>()({ name: "test-image" });

const makeSnapshotRun = () =>
  Effect.sync(() => ({
    handle: fakeSnapshotHandle,
    runSandbox: () =>
      Effect.sync(() => ({
        sandbox: fakeSandbox,
        runAgent: () => Effect.sync(makeFakeSession),
      })),
  }));

const makeFakeSession = (): Harness.AgentSession => {
  let responded = false;

  return {
    trajectory: Effect.sync(() => (responded ? Prompt.make("response") : Prompt.empty)),
    prompt: () =>
      Stream.succeed(finishPart).pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            responded = true;
          }),
        ),
      ),
  } satisfies Harness.AgentSession;
};

const fakeHarness = {
  metadata: Harness.Metadata.make({
    id: "harness",
    name: Option.none(),
    description: Option.none(),
  }),
  runSnapshot: makeSnapshotRun,
} satisfies Harness.Harness;

it.effect("emits task and eval stop events at completion", () =>
  Effect.gen(function* () {
    let harnessRunCount = 0;
    const harness = {
      ...fakeHarness,
      runSnapshot: () =>
        Effect.sync(() => {
          harnessRunCount += 1;
          return {
            handle: fakeSnapshotHandle,
            runSandbox: () =>
              Effect.sync(() => ({
                sandbox: fakeSandbox,
                runAgent: () => Effect.sync(makeFakeSession),
              })),
          };
        }),
    } satisfies Harness.Harness;
    const events: Array<Event.Event> = [];
    const transport: Event.Transport.Transport = {
      send: (stream: Event.EventStream) =>
        stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ),
        ),
    } satisfies Event.Transport.Transport;

    const task = yield* Task.make({
      id: "task",
      name: "task",
      snapshot: Snapshot.make("test-image"),
      prompt: "test",
      grader: Grade.make(GradeResult)(async () => ({ passed: true })),
    });
    const bench = yield* Bench.make("bench", Tasks.fromIter([Effect.succeed(task)]));

    const result = yield* Effect.succeed(bench).pipe(
      Eval.run({ snapshotConcurrency: 1, trailConcurrency: 2, trailCount: 2 }),
      Effect.provideService(Harness.Service, harness),
      Effect.provideService(Event.Transport.Service, transport),
    );

    assert.strictEqual(result.tasks.task?.trails.length, 2);
    assert.strictEqual(harnessRunCount, 1);
    const trailStopIndices = events.flatMap((event, index) =>
      event._tag === "TrailScheduleEvent" && event.task === "task" && event.op === "stop"
        ? [index]
        : [],
    );
    const taskStopIndices = events.flatMap((event, index) =>
      event._tag === "TaskScheduleEvent" && event.task === "task" && event.op === "stop"
        ? [index]
        : [],
    );

    const evalStopIndices = events.flatMap((event, index) =>
      event._tag === "EvalScheduleEvent" && event.op === "stop" ? [index] : [],
    );

    assert.strictEqual(trailStopIndices.length, 2);
    assert.strictEqual(taskStopIndices.length, 1);
    assert.strictEqual(evalStopIndices.length, 1);
    assert.isTrue(Math.max(...trailStopIndices) < taskStopIndices[0]);
    assert.isTrue(Math.max(...taskStopIndices) < evalStopIndices[0]);
  }),
);

it.effect("builds a shared snapshot once for tasks in the same group", () =>
  Effect.gen(function* () {
    let buildSnapshotCount = 0;
    const harness = {
      ...fakeHarness,
      runSnapshot: () =>
        Effect.sync(() => {
          buildSnapshotCount += 1;
          return {
            handle: fakeSnapshotHandle,
            runSandbox: () =>
              Effect.sync(() => ({
                sandbox: fakeSandbox,
                runAgent: () => Effect.sync(makeFakeSession),
              })),
          };
        }),
    } satisfies Harness.Harness;
    const transport: Event.Transport.Transport = {
      send: (stream: Event.EventStream) => Stream.runDrain(stream),
    };
    const snapshot = Snapshot.make("shared-image");
    const makeTask = (id: string) =>
      Task.make({
        id,
        name: id,
        snapshot,
        prompt: "test",
        grader: Grade.make(GradeResult)(async () => ({ passed: true })),
      });
    const bench = yield* Bench.make(
      "shared-snapshot-bench",
      Tasks.fromIter([makeTask("first"), makeTask("second")]),
    );

    const result = yield* Effect.succeed(bench).pipe(
      Eval.run({ snapshotConcurrency: 2, trailConcurrency: 2, trailCount: 2 }),
      Effect.provideService(Harness.Service, harness),
      Effect.provideService(Event.Transport.Service, transport),
    );

    assert.strictEqual(buildSnapshotCount, 1);
    assert.strictEqual(result.tasks.first?.trails.length, 2);
    assert.strictEqual(result.tasks.second?.trails.length, 2);
  }),
);

it.effect("builds distinct snapshots separately across task groups", () =>
  Effect.gen(function* () {
    let buildSnapshotCount = 0;
    const harness = {
      ...fakeHarness,
      runSnapshot: () =>
        Effect.sync(() => {
          buildSnapshotCount += 1;
          return {
            handle: fakeSnapshotHandle,
            runSandbox: () =>
              Effect.sync(() => ({
                sandbox: fakeSandbox,
                runAgent: () => Effect.sync(makeFakeSession),
              })),
          };
        }),
    } satisfies Harness.Harness;
    const transport: Event.Transport.Transport = {
      send: (stream: Event.EventStream) => Stream.runDrain(stream),
    };
    const makeTask = (id: string, snapshot: Snapshot.Snapshot) =>
      Task.make({
        id,
        name: id,
        snapshot,
        prompt: "test",
        grader: Grade.make(GradeResult)(async () => ({ passed: true })),
      });
    const bench = yield* Bench.make(
      "distinct-snapshot-bench",
      Tasks.fromIter([
        makeTask("first", Snapshot.make("image-a")),
        makeTask("second", Snapshot.make("image-b")),
      ]),
    );

    const result = yield* Effect.succeed(bench).pipe(
      Eval.run({ snapshotConcurrency: 2, trailConcurrency: 2, trailCount: 1 }),
      Effect.provideService(Harness.Service, harness),
      Effect.provideService(Event.Transport.Service, transport),
    );

    assert.strictEqual(buildSnapshotCount, 2);
    assert.strictEqual(result.tasks.first?.trails.length, 1);
    assert.strictEqual(result.tasks.second?.trails.length, 1);
  }),
);

it.effect("verifies stable encoded fields while allowing dynamic grade fields", () =>
  Effect.gen(function* () {
    let verifierRunCount = 0;
    const DynamicGradeResult = Schema.Struct({
      passed: Schema.Boolean,
      summary: Schema.String,
    });
    const transport: Event.Transport.Transport = {
      send: (stream: Event.EventStream) => Stream.runDrain(stream),
    };

    const task = yield* Task.make({
      id: "verif-task",
      name: "verif task",
      snapshot: Snapshot.make("test-image"),
      prompt: "test",
      grader: Grade.make(DynamicGradeResult)(
        async ({ trajectory }) =>
          trajectory.content.length === 0
            ? { passed: false, summary: "initial" }
            : { passed: true, summary: "1 passed in 0.25s" },
        {
          verif: async () => {
            verifierRunCount += 1;
            if (verifierRunCount > 1) {
              throw new globalThis.Error("Verifier must run once per stage");
            }
            return "verified";
          },
          expect: { passed: true },
        },
      ),
    });
    const bench = yield* Bench.make("verif-bench", Tasks.fromIter([Effect.succeed(task)]));

    const result = yield* Effect.succeed(bench).pipe(
      Eval.run({
        snapshotConcurrency: 1,
        taskConcurrency: 1,
        trailConcurrency: 1,
        trailCount: 1,
        verifMode: true,
      }),
      Effect.provideService(Harness.Service, fakeHarness),
      Effect.provideService(Event.Transport.Service, transport),
    );

    assert.deepStrictEqual(result.tasks["verif-task"]?.trails[0]?.grade, {
      passed: true,
      summary: "1 passed in 0.25s",
    });
    assert.strictEqual(verifierRunCount, 1);
  }),
);
