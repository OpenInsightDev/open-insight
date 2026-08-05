import { assert, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";
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

const makeFakeSession = (): Harness.Session => {
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
  } satisfies Harness.Session;
};

const fakeHarness = {
  metadata: Harness.Metadata.make({
    id: "harness",
    name: Option.none(),
    description: Option.none(),
  }),
  run: () =>
    Effect.succeed({
      sandbox: fakeSandbox,
      runSession: () => Effect.sync(makeFakeSession),
    }),
} satisfies Harness.Harness;

it.effect("emits task and eval stop events at completion", () =>
  Effect.gen(function* () {
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
    }).pipe(
      Task.stage("grade", {
        id: "grade",
        prompt: async ({ trajectory }) => (trajectory.content.length === 0 ? "test" : null),
        grader: Grade.make(GradeResult)(async () => ({ passed: true })),
      }),
    );
    const bench = yield* Bench.make("bench", Tasks.fromIter([Effect.succeed(task)]));

    const result = yield* Effect.succeed(bench).pipe(
      Eval.run({ snapshotConcurrency: 1, trailConcurrency: 2, trailCount: 2 }),
      Effect.provideService(Harness.Service, fakeHarness),
      Effect.provideService(Event.Transport.Service, transport),
    );

    assert.strictEqual(result.tasks.task?.trails.length, 2);
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

it.effect("verifies stable encoded fields while allowing dynamic grade fields", () =>
  Effect.gen(function* () {
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
    }).pipe(
      Task.stage("grade", {
        id: "grade",
        prompt: "test",
        grader: Grade.make(DynamicGradeResult)(
          async ({ trajectory }) =>
            trajectory.content.length === 0
              ? { passed: false, summary: "initial" }
              : { passed: true, summary: "1 passed in 0.25s" },
          {
            verif: async () => "verified",
            expect: { passed: true },
          },
        ),
      }),
    );
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
  }),
);
