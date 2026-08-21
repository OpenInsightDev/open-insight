import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Harness, Prompt, Response, Sandbox, Snapshot } from "@open-insight/core/internal";
import { Brand, Effect, Option, Ref, Schema, Stream } from "effect";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import * as Eval from "./index.ts";
import { EvalError } from "./error.ts";
import { make as makeEvalStream } from "./stream.ts";

const GradeResult = Schema.Struct({ score: Schema.Number });
type GradeResult = typeof GradeResult.Type;

const testSnapshot = Brand.nominal<Snapshot.Snapshot>()({ name: "stream-test-snapshot" });

const usage = (tokens: number) =>
  new Response.Usage({
    inputTokens: {
      uncached: tokens,
      total: tokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: tokens,
      text: tokens,
      reasoning: undefined,
    },
  });

const responseParts = (text: string, tokens = 1): ReadonlyArray<Response.AnyStreamPart> => [
  Response.makePart("text-start", { id: `text-${text}` }),
  Response.makePart("text-delta", { id: `text-${text}`, delta: text }),
  Response.makePart("text-end", { id: `text-${text}` }),
  Response.makePart("finish", {
    reason: "stop",
    usage: usage(tokens),
    response: undefined,
  }),
];

const sandbox = {
  spawn: () =>
    Effect.succeed({
      exitCode: ExitCode(0),
      stdout: "",
      stderr: "",
    }),
  exitCode: () => Effect.succeed(ExitCode(0)),
  success: () => Effect.void,
  stdout: () => Effect.succeed(""),
  stderr: () => Effect.succeed(""),
  readFile: () => Effect.succeed(""),
  writeFile: () => Effect.void,
  download: () => Effect.void,
  upload: () => Effect.void,
  expose: () => Effect.succeed({ hostUrl: "http://stream.test" }),
} satisfies Sandbox.Sandbox;

type AgentPrompt = (
  prompt: Prompt.Prompt,
  agentIndex: number,
) => Stream.Stream<Response.AnyStreamPart, Harness.HarnessError>;

type GradeExec = (context: Grade.Base.Context, call: number) => PromiseLike<GradeResult>;

type FixtureOptions = Readonly<{
  taskCount?: number;
  prompt?: Prompt.Gen.Options;
  agentPrompt?: AgentPrompt;
  grade?: GradeExec;
  taskMetrics?: ReadonlyArray<Metric.Task.Metric<typeof GradeResult>>;
  trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
  schedMetrics?: ReadonlyArray<Metric.Sched.Metric>;
  benchMetrics?: ReadonlyArray<Metric.Bench.Metric<GradeResult>>;
  persist?: Event.Persist.Persist;
  snapshotError?: Harness.HarnessError;
}>;

const makeFixture = Effect.fn("test.makeStreamFixture")(function* (options: FixtureOptions = {}) {
  const runSnapshotCalls = yield* Ref.make(0);
  const runSandboxCalls = yield* Ref.make(0);
  const runAgentCalls = yield* Ref.make(0);
  const gradeCalls = yield* Ref.make(0);

  const makeAgentSession = Effect.fn("test.makeAgentSession")(function* (agentIndex: number) {
    const trajectory = yield* Ref.make(Prompt.empty as Prompt.Trajectory);

    const prompt: Harness.AgentSession["prompt"] = (input) => {
      const parts = responseParts(`answer-${agentIndex}`);
      const response = options.agentPrompt?.(input, agentIndex) ?? Stream.fromIterable(parts);

      return response.pipe(
        Stream.onStart(Ref.update(trajectory, Prompt.concat(input))),
        Stream.onEnd(
          Ref.update(
            trajectory,
            Prompt.concat(Prompt.fromResponseParts(parts as ReadonlyArray<Response.AnyPart>)),
          ),
        ),
      );
    };

    return { trajectory, prompt } satisfies Harness.AgentSession;
  });

  const runAgent: Harness.SandboxSession["runAgent"] = Effect.fn("test.runAgent")(function* () {
    const agentIndex = yield* Ref.getAndUpdate(runAgentCalls, (count) => count + 1);
    return yield* makeAgentSession(agentIndex);
  });

  const sandboxSession = {
    sandbox,
    runAgent,
  } satisfies Harness.SandboxSession;

  const snapshotSession = {
    snapshot: testSnapshot,
    runSandbox: () =>
      Ref.update(runSandboxCalls, (count) => count + 1).pipe(Effect.as(sandboxSession)),
  } satisfies Harness.SnapshotSession;

  const harness = Harness.Service.of({
    metadata: Harness.Metadata.make({
      id: "test-harness",
      name: Option.none(),
      description: Option.none(),
    }),
    runSnapshot: () =>
      Ref.update(runSnapshotCalls, (count) => count + 1).pipe(
        Effect.andThen(
          options.snapshotError === undefined
            ? Effect.succeed(snapshotSession)
            : Effect.fail(options.snapshotError),
        ),
      ),
  });

  const sandboxProvider = Sandbox.ProviderService.of({
    acquireSnapshot: () => Effect.succeed(testSnapshot),
    deriveSnapshot: () => Effect.succeed(testSnapshot),
    runSandbox: () => Effect.succeed(sandbox),
  });

  const taskCount = options.taskCount ?? 1;
  const makeTask = Task.make(GradeResult);
  const tasks = yield* Effect.all(
    globalThis.Array.from({ length: taskCount }, (_, index) =>
      makeTask({
        id: `task-${index}`,
        snapshot: Snapshot.Alpine,
        prompt: options.prompt ?? { init: `initial-${index}` },
        grader: Grade.embed(async (context) => {
          const call = await Effect.runPromise(Ref.getAndUpdate(gradeCalls, (count) => count + 1));
          return options.grade?.(context, call) ?? { score: context.trajectory.content.length };
        }),
        metrics: options.taskMetrics,
        trajMetrics: options.trajMetrics,
        schedMetrics: options.schedMetrics,
      }),
    ),
  );

  const bench = yield* Bench.make("test-bench", Effect.succeed(tasks), {
    metrics: options.benchMetrics,
  });

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
    let provided = effect.pipe(
      Effect.provideService(Harness.Service, harness),
      Effect.provideService(Sandbox.ProviderService, sandboxProvider),
      Effect.provide(NodeServices.layer),
    );
    if (options.persist !== undefined) {
      provided = provided.pipe(Effect.provideService(Event.Persist.Service, options.persist));
    }
    return provided;
  };

  return {
    bench,
    provide,
    runSnapshotCalls,
    runSandboxCalls,
    runAgentCalls,
    gradeCalls,
  };
});

const eventTags = (events: Iterable<Event.EvalEvent>) =>
  globalThis.Array.from(events, (event) => event._tag);

describe("evaluation stream projections", () => {
  it.effect("keeps error events in the event view and drops the terminal result signal", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const id: Event.BenchID = { benchId: "test-bench", harnessId: "test-harness" };
      const start = Event.BenchStartEvent.make({
        id,
        bench: fixture.bench.metadata,
        harness: Harness.Metadata.make({
          id: "test-harness",
          name: Option.none(),
          description: Option.none(),
        }),
        metrics: [],
      });
      const error = EvalError.init(new Error("expected"));
      const errorEvent = Event.BenchErrorEvent.make({ id, error });
      const result = Event.BenchResult.make({ id, tasks: {} });

      const events = yield* Stream.succeed(start).pipe(
        Stream.concat(Stream.fail(errorEvent)),
        Eval.stream,
        Stream.runCollect,
      );
      assert.deepStrictEqual(eventTags(events), ["BenchStartEvent", "BenchErrorEvent"]);

      const successfulEvents = yield* Stream.succeed(start).pipe(
        Stream.concat(Stream.fail(result)),
        Eval.stream,
        Stream.runCollect,
      );
      assert.deepStrictEqual(eventTags(successfulEvents), ["BenchStartEvent"]);

      const projectedError = yield* Eval.result(Stream.fail(errorEvent)).pipe(Effect.flip);
      assert.strictEqual(projectedError, error);
    }),
  );
});

describe("stream.ts evaluation orchestration", () => {
  it.effect("runs a complete bench and emits ordered lifecycle events with a nested result", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const raw = makeEvalStream(fixture.bench, {
        otel: {},
        snapshotConcurrency: 1,
        trailConcurrency: 1,
        trailCount: 1,
        verify: false,
      });

      const events = yield* fixture.provide(raw.pipe(Eval.stream, Stream.runCollect));
      assert.deepStrictEqual(eventTags(events), [
        "BenchStartEvent",
        "TaskStartEvent",
        "TrailStartEvent",
        "SessionStartEvent",
        "SessionPromptEvent",
        "SessionStreamEvent",
        "SessionStreamEvent",
        "SessionStreamEvent",
        "SessionStreamEvent",
        "SessionEndEvent",
        "TrailEndEvent",
        "TaskEndEvent",
        "BenchEndEvent",
      ]);

      const result = yield* fixture.provide(
        Eval.result(
          makeEvalStream(fixture.bench, {
            otel: {},
            snapshotConcurrency: 1,
            trailConcurrency: 1,
            trailCount: 1,
            verify: false,
          }),
        ),
      );
      const task = result.tasks["task-0"];
      assert.isDefined(task);
      assert.lengthOf(task.trails, 1);
      assert.deepStrictEqual(task.trails[0]?.grade, { score: 2 });
      assert.lengthOf(task.trails[0]?.sessions ?? [], 1);
      assert.strictEqual(task.trails[0]?.sessions[0]?.usage?.inputTokens.total, 1);
      assert.lengthOf(task.trails[0]?.sessions[0]?.trajectory.content ?? [], 2);
    }),
  );

  it.effect("runs all configured trails and aggregates each result by trail index", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const result = yield* fixture.provide(
        Eval.result(
          makeEvalStream(fixture.bench, {
            otel: {},
            snapshotConcurrency: 1,
            trailConcurrency: 2,
            trailCount: 3,
            verify: false,
          }),
        ),
      );

      const trails = result.tasks["task-0"]?.trails ?? [];
      assert.lengthOf(trails, 3);
      assert.deepStrictEqual(
        trails.map((trail) => trail.id.trailIdx).toSorted((left, right) => left - right),
        [0, 1, 2],
      );
      assert.strictEqual(yield* Ref.get(fixture.runAgentCalls), 3);
      assert.strictEqual(yield* Ref.get(fixture.gradeCalls), 3);
    }),
  );

  it.effect("runs multiple generated turns in one session and grades the complete trajectory", () =>
    Effect.gen(function* () {
      let promptCalls = 0;
      const options = {
        prompt: {
          init: "initial",
          fn: () => async () => {
            promptCalls += 1;
            return promptCalls === 1 ? "follow-up" : null;
          },
        },
      } satisfies FixtureOptions;

      const eventFixture = yield* makeFixture(options);
      const events = yield* eventFixture.provide(
        makeEvalStream(eventFixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );
      const prompts = globalThis.Array.from(events).filter(
        (event): event is Event.SessionPromptEvent => event._tag === "SessionPromptEvent",
      );
      assert.lengthOf(prompts, 2);
      assert.strictEqual(promptCalls, 2);

      promptCalls = 0;
      const resultFixture = yield* makeFixture(options);
      const result = yield* resultFixture.provide(
        Eval.result(
          makeEvalStream(resultFixture.bench, {
            otel: {},
            snapshotConcurrency: 1,
            trailConcurrency: 1,
            trailCount: 1,
            verify: false,
          }),
        ),
      );
      assert.deepStrictEqual(result.tasks["task-0"]?.trails[0]?.grade, { score: 4 });
      assert.lengthOf(result.tasks["task-0"]?.trails[0]?.sessions[0]?.trajectory.content ?? [], 4);
    }),
  );

  for (const retryType of ["continue", "restart"] as const) {
    it.effect(`supports a grader-requested ${retryType} retry`, () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          grade: async (context, call) => {
            if (call === 0) {
              throw Grade.retry({
                type: retryType,
                prompt: Prompt.make("retry-prompt"),
                reason: `${retryType}-reason`,
              });
            }
            return { score: context.trajectory.content.length };
          },
        });
        const raw = makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        });
        const events = yield* fixture.provide(raw.pipe(Eval.stream, Stream.runCollect));

        const retries = globalThis.Array.from(events).filter(
          (event): event is Event.SessionRetryEvent => event._tag === "SessionRetryEvent",
        );
        assert.lengthOf(retries, 1);
        assert.strictEqual(retries[0]?.id.sessionIdx, 0);
        assert.strictEqual(retries[0]?.reason, `${retryType}-reason`);

        const sessions = globalThis.Array.from(events).filter(
          (event): event is Event.SessionStartEvent => event._tag === "SessionStartEvent",
        );
        assert.deepStrictEqual(
          sessions.map((event) => event.id.sessionIdx),
          [0, 1],
        );
        assert.strictEqual(yield* Ref.get(fixture.runAgentCalls), retryType === "continue" ? 1 : 2);
        assert.strictEqual(yield* Ref.get(fixture.gradeCalls), 2);
      }),
    );
  }

  it.effect("normalizes an agent stream failure into a SessionErrorEvent", () =>
    Effect.gen(function* () {
      const harnessError = Harness.HarnessError.sessionNotStarted();
      const fixture = yield* makeFixture({
        agentPrompt: () => Stream.fail(harnessError),
      });
      const events = yield* fixture.provide(
        makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );

      assert.deepStrictEqual(eventTags(events), [
        "BenchStartEvent",
        "TaskStartEvent",
        "TrailStartEvent",
        "SessionStartEvent",
        "SessionPromptEvent",
        "SessionErrorEvent",
      ]);
      const failure = globalThis.Array.from(events).at(-1);
      assert.strictEqual(failure?._tag, "SessionErrorEvent");
      if (failure?._tag === "SessionErrorEvent") {
        assert.instanceOf(failure.error, EvalError);
        assert.strictEqual(failure.error.reason, harnessError);
      }
    }),
  );

  it.effect("normalizes a follow-up prompt generation failure into a SessionErrorEvent", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        prompt: {
          init: "initial",
          fn: () => async () => {
            throw new Error("prompt failed");
          },
        },
      });
      const events = yield* fixture.provide(
        makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );

      assert.strictEqual(globalThis.Array.from(events).at(-1)?._tag, "SessionErrorEvent");
      assert.notInclude(eventTags(events), "SessionEndEvent");
      assert.notInclude(eventTags(events), "TrailEndEvent");
    }),
  );

  it.effect("normalizes a grader failure into a TrailErrorEvent", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        grade: async () => {
          throw new Error("grade failed");
        },
      });
      const events = yield* fixture.provide(
        makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );

      assert.strictEqual(globalThis.Array.from(events).at(-1)?._tag, "TrailErrorEvent");
      assert.notInclude(eventTags(events), "TrailEndEvent");
      assert.notInclude(eventTags(events), "TaskEndEvent");
      assert.notInclude(eventTags(events), "BenchEndEvent");
    }),
  );

  it.effect("normalizes snapshot initialization failure into a TaskErrorEvent", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        snapshotError: Harness.HarnessError.sessionNotStarted(),
      });
      const events = yield* fixture.provide(
        makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );

      assert.deepStrictEqual(eventTags(events), ["BenchStartEvent", "TaskErrorEvent"]);
      assert.strictEqual(yield* Ref.get(fixture.runSandboxCalls), 0);
      assert.strictEqual(yield* Ref.get(fixture.runAgentCalls), 0);
    }),
  );

  it.effect("publishes trajectory, schedule, task, and bench metric events", () =>
    Effect.gen(function* () {
      const trajMetric = yield* Metric.Traj.make({
        id: "trajectory-count",
        exec: (_state, _delta, previous) => (typeof previous === "number" ? previous : 0) + 1,
      });
      const schedMetric = yield* Metric.Sched.make({
        id: "schedule-count",
        exec: (_sandbox, previous) => (typeof previous === "number" ? previous : 0) + 1,
        times: 0,
      });
      const taskMetric = yield* Metric.Task.makeCollect<typeof GradeResult, number>({
        id: "task-count",
        exec: (results) => results.length,
      });
      const benchMetric = yield* Metric.Bench.make<GradeResult, number>({
        id: "bench-count",
        exec: (results) => Object.keys(results).length,
      });
      const fixture = yield* makeFixture({
        trajMetrics: [trajMetric],
        schedMetrics: [schedMetric],
        taskMetrics: [taskMetric],
        benchMetrics: [benchMetric],
      });
      const events = yield* fixture.provide(
        makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );

      const tags = eventTags(events);
      assert.include(tags, "SessionMetricEvent");
      assert.include(tags, "TrailMetricEvent");
      assert.include(tags, "TaskMetricEvent");
      assert.include(tags, "BenchMetricEvent");
    }),
  );

  it.effect("uses a persisted bench stream without starting new execution", () =>
    Effect.gen(function* () {
      let persistCalls = 0;
      const id: Event.BenchID = { benchId: "test-bench", harnessId: "test-harness" };
      const cachedResult = Event.BenchResult.make({ id, tasks: {} });
      const persist = Event.Persist.Service.of({
        getBench: () => Option.some(Stream.fail(cachedResult)),
        getTask: () => Option.none(),
        getTrail: () => Option.none(),
        persist: () =>
          Effect.sync(() => {
            persistCalls += 1;
          }),
      });
      const fixture = yield* makeFixture({ persist });
      const result = yield* fixture.provide(
        Eval.result(
          makeEvalStream(fixture.bench, {
            otel: {},
            snapshotConcurrency: 1,
            trailConcurrency: 1,
            trailCount: 1,
            verify: false,
          }),
        ),
      );

      assert.strictEqual(result, cachedResult);
      assert.strictEqual(yield* Ref.get(fixture.runSnapshotCalls), 0);
      assert.strictEqual(yield* Ref.get(fixture.runSandboxCalls), 0);
      assert.strictEqual(yield* Ref.get(fixture.runAgentCalls), 0);
      assert.strictEqual(persistCalls, 0);
    }),
  );

  it.effect("uses a persisted trail result without starting a sandbox or agent", () =>
    Effect.gen(function* () {
      const persist = Event.Persist.Service.of({
        getBench: () => Option.none(),
        getTask: () => Option.none(),
        getTrail: (id) =>
          Option.some(
            Stream.fail(
              Event.TrailResult.make({
                id,
                grade: { score: 99 },
                sessions: [],
              }),
            ),
          ),
        persist: (stream) => Stream.runDrain(stream),
      });
      const fixture = yield* makeFixture({ persist });
      const result = yield* fixture.provide(
        Eval.result(
          makeEvalStream(fixture.bench, {
            otel: {},
            snapshotConcurrency: 1,
            trailConcurrency: 1,
            trailCount: 1,
            verify: false,
          }),
        ),
      );

      assert.deepStrictEqual(result.tasks["task-0"]?.trails[0]?.grade, { score: 99 });
      assert.strictEqual(yield* Ref.get(fixture.runSnapshotCalls), 1);
      assert.strictEqual(yield* Ref.get(fixture.runSandboxCalls), 0);
      assert.strictEqual(yield* Ref.get(fixture.runAgentCalls), 0);
      assert.strictEqual(yield* Ref.get(fixture.gradeCalls), 0);
    }),
  );

  it.effect("persists the published event stream and excludes the terminal result signal", () =>
    Effect.gen(function* () {
      const persistedTags: Array<string> = [];
      const persist = Event.Persist.Service.of({
        getBench: () => Option.none(),
        getTask: () => Option.none(),
        getTrail: () => Option.none(),
        persist: (stream) =>
          stream.pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                persistedTags.push(event._tag);
              }),
            ),
          ),
      });
      const fixture = yield* makeFixture({ persist });

      yield* fixture.provide(
        Eval.result(
          makeEvalStream(fixture.bench, {
            otel: {},
            snapshotConcurrency: 1,
            trailConcurrency: 1,
            trailCount: 1,
            verify: false,
          }),
        ),
      );

      assert.deepStrictEqual(persistedTags, [
        "BenchStartEvent",
        "TaskStartEvent",
        "TrailStartEvent",
        "SessionStartEvent",
        "SessionPromptEvent",
        "SessionStreamEvent",
        "SessionStreamEvent",
        "SessionStreamEvent",
        "SessionStreamEvent",
        "SessionEndEvent",
        "TrailEndEvent",
        "TaskEndEvent",
        "BenchEndEvent",
      ]);
    }),
  );

  it.effect("surfaces a persistence failure instead of returning a successful result", () =>
    Effect.gen(function* () {
      const persistError = Event.EventError.send(new Error("persist failed"));
      const persist = Event.Persist.Service.of({
        getBench: () => Option.none(),
        getTask: () => Option.none(),
        getTrail: () => Option.none(),
        persist: (stream) =>
          stream.pipe(Stream.runDrain, Effect.andThen(Effect.fail(persistError))),
      });
      const fixture = yield* makeFixture({ persist });
      const events = yield* fixture.provide(
        makeEvalStream(fixture.bench, {
          otel: {},
          snapshotConcurrency: 1,
          trailConcurrency: 1,
          trailCount: 1,
          verify: false,
        }).pipe(Eval.stream, Stream.runCollect),
      );

      const failure = globalThis.Array.from(events).at(-1);
      assert.strictEqual(failure?._tag, "BenchErrorEvent");
      if (failure?._tag === "BenchErrorEvent") {
        assert.instanceOf(failure.error, EvalError);
        assert.strictEqual(failure.error.reason, persistError);
      }
    }),
  );
});
