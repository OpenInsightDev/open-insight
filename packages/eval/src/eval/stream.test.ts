import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Agent, Harness, Prompt, Response, Sandbox, Snapshot } from "@open-insight/core/internal";
import { Brand, Deferred, Effect, Fiber, Layer, Option, Ref, Schema, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import * as Eval from "./index.ts";

const GradeResult = Schema.Struct({ score: Schema.Number });
const CountResult = Schema.Struct({ count: Schema.Number });

const usage = new Response.Usage({
  inputTokens: { total: 3 },
  outputTokens: { total: 5 },
});

const responseParts = (
  text: string,
  reason: Response.FinishReason = "stop",
): ReadonlyArray<Response.StreamPartEncoded> => [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: text },
  { type: "text-end", id: "text" },
  {
    type: "finish",
    reason,
    usage: {
      inputTokens: { total: usage.inputTokens.total },
      outputTokens: { total: usage.outputTokens.total },
    },
  },
];

const snapshot = Brand.nominal<Snapshot.Snapshot>()({ name: "eval-stream-test" });

const sandbox = {
  spawn: () => Effect.die("sandbox spawn is not used by this test"),
  exitCode: () => Effect.die("sandbox exitCode is not used by this test"),
  success: () => Effect.die("sandbox success is not used by this test"),
  stdout: () => Effect.die("sandbox stdout is not used by this test"),
  stderr: () => Effect.die("sandbox stderr is not used by this test"),
  readFile: () => Effect.die("sandbox readFile is not used by this test"),
  writeFile: () => Effect.die("sandbox writeFile is not used by this test"),
  download: () => Effect.die("sandbox download is not used by this test"),
  upload: () => Effect.die("sandbox upload is not used by this test"),
  expose: () => Effect.die("sandbox expose is not used by this test"),
} satisfies Sandbox.Sandbox;

type AgentPlan = (
  sessionIdx: number,
  promptIdx: number,
  prompt: Prompt.Prompt,
) => ReadonlyArray<Response.StreamPartEncoded> | Stream.Stream<Response.StreamPartEncoded, never>;

const makeRuntimeLayer = (plan: AgentPlan) => {
  let sessionIdx = -1;

  const sandboxProvider = {
    acquireSnapshot: () => Effect.succeed(snapshot),
    deriveSnapshot: () => Effect.succeed(snapshot),
    runSandbox: () => Effect.succeed(sandbox),
  } satisfies Sandbox.Provider;
  const sandboxLayer = Layer.succeed(Sandbox.ProviderService)(sandboxProvider);

  const agentProvider = {
    snapshotExtension: Option.none(),
    runSession: () => {
      sessionIdx += 1;
      const currentSessionIdx = sessionIdx;
      let promptIdx = 0;
      return Agent.make((prompt) => {
        const response = plan(currentSessionIdx, promptIdx, prompt);
        promptIdx += 1;
        return Stream.isStream(response) ? response : Stream.fromIterable(response);
      });
    },
  } satisfies Agent.Provider;
  const providerLayers = Layer.mergeAll(
    sandboxLayer,
    Layer.succeed(Agent.ProviderService)(agentProvider),
  );
  const harnessLayer = Harness.Service.layer("test-harness").pipe(Layer.provide(providerLayers));

  return Layer.mergeAll(harnessLayer, sandboxLayer, NodeServices.layer);
};

type MakeBenchOptions = Readonly<{
  benchId?: string;
  prompt?: Prompt.Options;
  grade?: Grade.Base.Exec<typeof GradeResult>;
  taskIds?: ReadonlyArray<string>;
  taskMetrics?: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
  schedMetrics?: ReadonlyArray<Metric.Sched.Metric>;
  benchMetrics?: ReadonlyArray<Metric.Bench.Metric>;
}>;

const makeBench = Effect.fn(function* (options: MakeBenchOptions = {}) {
  const taskIds = options.taskIds ?? ["task-1"];
  const tasks = yield* Effect.all(
    taskIds.map((id) =>
      Task.make(GradeResult)({
        id,
        snapshot: Snapshot.Alpine,
        prompt: options.prompt ?? "solve",
        grader: Grade.embed(options.grade ?? (async () => ({ score: 1 }))),
        metrics: options.taskMetrics,
        trajMetrics: options.trajMetrics,
        schedMetrics: options.schedMetrics,
      }),
    ),
  );

  return yield* Bench.make(options.benchId ?? "bench-1", Effect.succeed(tasks), {
    metrics: options.benchMetrics,
  });
});

const runAndCapture = Effect.fn(function* <T extends Task.AnyTask>(
  bench: Bench.Bench<T>,
  config: Partial<Config> = {},
) {
  const eventsRef = yield* Ref.make<Array<Event.EvalEvent>>([]);
  const result = yield* Eval.run(bench, config).pipe(
    Stream.tap((event) => Ref.update(eventsRef, (events) => [...events, event])),
    Eval.result,
  );
  const events = yield* Ref.get(eventsRef);
  return { events, result };
});

const emptyPersist = (overrides: Partial<Event.Persist.Persist> = {}): Event.Persist.Persist => ({
  getBench: () => Option.none(),
  getTask: () => Option.none(),
  getTrail: () => Option.none(),
  persist: () => Effect.void,
  ...overrides,
});

describe("eval stream", () => {
  it.effect("emits the full lifecycle and aggregates the completed result", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench();
      const { events, result } = yield* runAndCapture(bench);

      assert.deepStrictEqual(
        events.map((event) => event._tag),
        [
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
        ],
      );

      const trail = result.tasks["task-1"]?.trails[0];
      assert.isDefined(trail);
      assert.deepStrictEqual(trail.grade, { score: 1 });
      assert.strictEqual(trail.sessions.length, 1);
      assert.strictEqual(trail.sessions[0]?.usage?.outputTokens.total, 5);

      const trailEnd = events.find((event) => event._tag === "TrailEndEvent");
      assert.isDefined(trailEnd);
      assert.strictEqual(trailEnd.usage?.outputTokens.total, 5);

      const sessionEnd = events.find((event) => event._tag === "SessionEndEvent");
      assert.isDefined(sessionEnd);
      assert.strictEqual(sessionEnd.reason, "stop");
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("interrupts active trails when the evaluation consumer is canceled", () =>
    Effect.gen(function* () {
      const responseStarted = yield* Deferred.make<void>();
      const responseStopped = yield* Deferred.make<void>();
      const releaseResponse = yield* Deferred.make<void>();
      const bench = yield* makeBench();
      const response = Stream.fromEffect(
        Deferred.succeed(responseStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseResponse)),
        ),
      ).pipe(Stream.drain, Stream.ensuring(Deferred.succeed(responseStopped, undefined)));
      const fiber = yield* Eval.run(bench).pipe(
        Stream.runDrain,
        Effect.provide(makeRuntimeLayer(() => response)),
        Effect.forkScoped,
      );

      yield* Deferred.await(responseStarted).pipe(Effect.timeout("1 second"));
      const interruptExit = yield* Fiber.interrupt(fiber).pipe(
        Effect.timeout("500 millis"),
        Effect.exit,
      );

      // Release a broken implementation before asserting, so a failed
      // cancellation check cannot strand the test scope during cleanup.
      yield* Deferred.succeed(releaseResponse, undefined);
      yield* Fiber.await(fiber).pipe(Effect.timeout("1 second"));
      yield* Deferred.await(responseStopped).pipe(Effect.timeout("1 second"));
      assert.strictEqual(interruptExit._tag, "Success");
    }).pipe(Effect.scoped),
  );

  it.effect("supports a continue retry on the same agent session", () => {
    const providerSessionIndices: number[] = [];

    return Effect.gen(function* () {
      let gradeCalls = 0;
      const bench = yield* makeBench({
        grade: async () => {
          gradeCalls += 1;
          if (gradeCalls === 1) {
            throw Grade.retry({
              type: "continue",
              prompt: Prompt.make("try again"),
              reason: "initial answer needs another turn",
            });
          }
          return { score: 2 };
        },
      });
      const { events, result } = yield* runAndCapture(bench);

      assert.strictEqual(gradeCalls, 2);
      // Continue reuses the provider session for both prompt turns.
      assert.deepStrictEqual(providerSessionIndices, [0, 0]);
      assert.strictEqual(events.filter((event) => event._tag === "SessionRetryEvent").length, 1);
      const sessionStarts = events.filter((event) => event._tag === "SessionStartEvent");
      assert.strictEqual(sessionStarts.length, 2);
      // sessionIdx identifies attempts, even when `continue` reuses the agent.
      assert.deepStrictEqual(
        sessionStarts.map((event) => event.sessionIdx),
        [0, 1],
      );
      assert.deepStrictEqual(result.tasks["task-1"]?.trails[0]?.grade, { score: 2 });
      assert.strictEqual(result.tasks["task-1"]?.trails[0]?.sessions.length, 2);
    }).pipe(
      Effect.provide(
        makeRuntimeLayer((sessionIdx) => {
          providerSessionIndices.push(sessionIdx);
          return responseParts("answer");
        }),
      ),
      Effect.scoped,
    );
  });

  it.effect("starts a fresh agent session for a restart retry", () => {
    const providerSessionIndices: number[] = [];

    return Effect.gen(function* () {
      let gradeCalls = 0;
      const bench = yield* makeBench({
        grade: async () => {
          gradeCalls += 1;
          if (gradeCalls === 1) {
            throw Grade.retry({
              type: "restart",
              prompt: Prompt.make("start over"),
              reason: "restart the attempt",
            });
          }
          return { score: 3 };
        },
      });
      const { events, result } = yield* runAndCapture(bench);

      assert.strictEqual(gradeCalls, 2);
      assert.deepStrictEqual(providerSessionIndices, [0, 1]);
      assert.deepStrictEqual(
        events
          .filter((event) => event._tag === "SessionStartEvent")
          .map((event) => event.sessionIdx),
        [0, 1],
      );
      assert.deepStrictEqual(result.tasks["task-1"]?.trails[0]?.grade, { score: 3 });
      assert.strictEqual(result.tasks["task-1"]?.trails[0]?.sessions.length, 2);
    }).pipe(
      Effect.provide(
        makeRuntimeLayer((sessionIdx) => {
          providerSessionIndices.push(sessionIdx);
          return responseParts("answer");
        }),
      ),
      Effect.scoped,
    );
  });

  it.effect("streams multi-turn prompts through trajectory metrics", () =>
    Effect.gen(function* () {
      const observedTrajectoryLengths: number[] = [];
      const trajectoryMetric = yield* Metric.Traj.make({
        id: "turn-kind",
        exec: (_state, delta) => ({ kind: Prompt.isPrompt(delta) ? "prompt" : "response" }),
      });
      const bench = yield* makeBench({
        prompt: {
          init: "first turn",
          followUp: async function* ({ trajectory }) {
            observedTrajectoryLengths.push(trajectory.content.length);
            const nextContext = yield "second turn";
            observedTrajectoryLengths.push(nextContext.trajectory.content.length);
          },
        },
        trajMetrics: [trajectoryMetric],
      });
      const { events, result } = yield* runAndCapture(bench);

      assert.strictEqual(events.filter((event) => event._tag === "SessionPromptEvent").length, 2);
      const metricKinds = events
        .flatMap((event) => (event._tag === "SessionMetricEvent" ? [event.value] : []))
        .map(
          (value) => Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.String }))(value).kind,
        );
      assert.deepStrictEqual(metricKinds, ["prompt", "response", "prompt", "response"]);
      assert.strictEqual(result.tasks["task-1"]?.trails[0]?.sessions.length, 1);
      assert.strictEqual(
        result.tasks["task-1"]?.trails[0]?.sessions[0]?.trajectory.content.length,
        4,
      );
      assert.deepStrictEqual(observedTrajectoryLengths, [2, 4]);
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("waits for each response before requesting a trajectory-dependent prompt", () =>
    Effect.gen(function* () {
      for (const metricCount of [0, 1, 2]) {
        const metricIds = ["trajectory-0", "trajectory-1"].slice(0, metricCount);
        const trajectoryMetrics = yield* Effect.all(
          metricIds.map((id) =>
            Metric.Traj.make({
              id,
              exec: (_state, delta) => ({
                kind: Prompt.isPrompt(delta) ? "prompt" : "response",
              }),
            }),
          ),
        );
        const observedTrajectoryLengths: number[] = [];
        const bench = yield* makeBench({
          // The second pull must see the assistant response committed by the
          // previous turn; otherwise this function would keep producing turns.
          prompt: async ({ trajectory }) => {
            observedTrajectoryLengths.push(trajectory.content.length);
            if (observedTrajectoryLengths.length > 1 && trajectory.content.length === 0) {
              throw new Error("next prompt was requested before the response updated trajectory");
            }
            return trajectory.content.length === 0 ? "first turn" : null;
          },
          trajMetrics: trajectoryMetrics,
        });
        const { events } = yield* runAndCapture(bench);

        assert.deepStrictEqual(observedTrajectoryLengths, [0, 2]);
        assert.strictEqual(events.filter((event) => event._tag === "SessionPromptEvent").length, 1);
        for (const id of metricIds) {
          const metricKinds = events
            .flatMap((event) =>
              event._tag === "SessionMetricEvent" && event.id === id ? [event.value] : [],
            )
            .map(
              (value) =>
                Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.String }))(value).kind,
            );
          assert.deepStrictEqual(metricKinds, ["prompt", "response"]);
        }
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("fans every trajectory delta out to every trajectory metric", () =>
    Effect.gen(function* () {
      const trajectoryMetrics = yield* Effect.all(
        ["trajectory-a", "trajectory-b"].map((id) =>
          Metric.Traj.make({
            id,
            exec: (_state, delta) => ({ kind: Prompt.isPrompt(delta) ? "prompt" : "response" }),
          }),
        ),
      );
      const bench = yield* makeBench({ trajMetrics: trajectoryMetrics });
      const { events } = yield* runAndCapture(bench);

      for (const id of ["trajectory-a", "trajectory-b"]) {
        const metricKinds = events
          .flatMap((event) =>
            event._tag === "SessionMetricEvent" && event.id === id ? [event.value] : [],
          )
          .map(
            (value) => Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.String }))(value).kind,
          );
        assert.deepStrictEqual(metricKinds, ["prompt", "response"]);
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("emits delayed metrics before their corresponding lifecycle end events", () =>
    Effect.gen(function* () {
      const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
      const trajectoryMetric = yield* Metric.Traj.make({
        id: "delayed-trajectory",
        exec: async (_state, delta) => {
          await pause();
          return { kind: Prompt.isPrompt(delta) ? "prompt" : "response" };
        },
      });
      const schedulerMetric = yield* Metric.Sched.make<Schema.Json>({
        id: "delayed-scheduler",
        times: 1,
        exec: async () => {
          await pause();
          return 1;
        },
      });
      const taskMetric = yield* Metric.Task.make({
        id: "delayed-task",
        exec: async (results) => {
          await pause();
          return results.length;
        },
      });
      const benchMetric = yield* Metric.Bench.make({
        id: "delayed-bench",
        exec: async (results) => {
          await pause();
          return Object.keys(results).length;
        },
      });
      const bench = yield* makeBench({
        trajMetrics: [trajectoryMetric],
        schedMetrics: [schedulerMetric],
        taskMetrics: [taskMetric],
        benchMetrics: [benchMetric],
      });
      const { events } = yield* runAndCapture(bench);

      for (const [metricTag, endTag] of [
        ["SessionMetricEvent", "SessionEndEvent"],
        ["TrailMetricEvent", "TrailEndEvent"],
        ["TaskMetricEvent", "TaskEndEvent"],
        ["BenchMetricEvent", "BenchEndEvent"],
      ] as const) {
        const metricIndices = events.flatMap((event, index) =>
          event._tag === metricTag ? [index] : [],
        );
        const endIndex = events.findIndex((event) => event._tag === endTag);
        assert.isNotEmpty(metricIndices);
        assert.isAtLeast(endIndex, 0);
        assert.isBelow(Math.max(...metricIndices), endIndex);
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("runs scheduler metrics while a trail is active", () =>
    Effect.gen(function* () {
      const schedulerMetric = yield* Metric.Sched.make<Schema.Json>({
        id: "schedule-ticks",
        times: 1,
        exec: async () => 1,
      });
      const bench = yield* makeBench({ schedMetrics: [schedulerMetric] });
      const { events } = yield* runAndCapture(bench);

      const metricEvents = events.filter((event) => event._tag === "TrailMetricEvent");
      assert.isAtLeast(metricEvents.length, 1);
      for (const event of metricEvents) {
        assert.strictEqual(Schema.decodeUnknownSync(Schema.Number)(event.value), 1);
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("maps scheduler metric failures before emitting a trail end", () =>
    Effect.gen(function* () {
      const brokenMetric = yield* Metric.Sched.make<Schema.Json>({
        id: "broken-scheduler-metric",
        times: 1,
        retry: { times: 0 },
        exec: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("scheduler metric failed");
        },
      });
      const bench = yield* makeBench({
        schedMetrics: [brokenMetric],
        grade: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { score: 1 };
        },
      });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "TrailErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "MetricError");
      }
      assert.isFalse(events.some((event) => event._tag === "TrailEndEvent"));
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("maps task metric failures to a typed task error", () =>
    Effect.gen(function* () {
      const brokenMetric = yield* Metric.Task.make({
        id: "broken-task-metric",
        exec: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw new Error("task metric failed");
        },
      });
      const bench = yield* makeBench({ taskMetrics: [brokenMetric] });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "TaskErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "MetricError");
      }
      assert.isFalse(events.some((event) => event._tag === "TaskEndEvent"));

      const resultExit = yield* Effect.exit(Eval.run(bench).pipe(Eval.result));
      assert.strictEqual(resultExit._tag, "Failure");
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("maps trajectory metric failures to a typed session error", () =>
    Effect.gen(function* () {
      const brokenMetric = yield* Metric.Traj.make({
        id: "broken-trajectory-metric",
        exec: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw new Error("trajectory metric failed");
        },
      });
      const bench = yield* makeBench({ trajMetrics: [brokenMetric] });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "SessionErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "MetricError");
      }
      assert.isFalse(events.some((event) => event._tag === "SessionEndEvent"));
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("maps bench metric failures to a typed bench error", () =>
    Effect.gen(function* () {
      const brokenMetric = yield* Metric.Bench.make({
        id: "broken-bench-metric",
        exec: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw new Error("bench metric failed");
        },
      });
      const bench = yield* makeBench({ benchMetrics: [brokenMetric] });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "BenchErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "MetricError");
      }
      assert.isFalse(events.some((event) => event._tag === "BenchEndEvent"));

      const resultExit = yield* Effect.exit(Eval.run(bench).pipe(Eval.result));
      assert.strictEqual(resultExit._tag, "Failure");
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("maps prompt generation failures to a session error", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench({
        prompt: async () => {
          throw new Error("prompt generation failed");
        },
      });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "SessionErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "TaskExecFailed");
      }

      const resultExit = yield* Effect.exit(Eval.run(bench).pipe(Eval.result));
      assert.strictEqual(resultExit._tag, "Failure");
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("replays a persisted bench result without executing workers", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench({ benchId: "persisted-bench" });
      const result = yield* Eval.run(bench).pipe(Eval.result);
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);

      assert.deepStrictEqual(result.tasks, {});
      assert.deepStrictEqual(events, []);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeRuntimeLayer(() => responseParts("answer")),
          Layer.succeed(
            Event.Persist.Service,
            emptyPersist({
              getBench: (id) =>
                id.benchId === "persisted-bench"
                  ? Option.some(
                      Stream.fromEffect(Event.resultDone(Event.BenchResult.make({ tasks: {} }))),
                    )
                  : Option.none(),
            }),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );

  it.effect("loads an existing trail from persistence and aggregates it", () =>
    Effect.gen(function* () {
      const grade = { score: 9 };
      const bench = yield* makeBench();
      const { events, result } = yield* runAndCapture(bench);

      assert.deepStrictEqual(result.tasks["task-1"]?.trails[0]?.grade, grade);
      assert.strictEqual(events.filter((event) => event._tag === "TrailStartEvent").length, 1);
      assert.strictEqual(events.filter((event) => event._tag === "SessionStartEvent").length, 0);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeRuntimeLayer(() => responseParts("answer")),
          Layer.succeed(
            Event.Persist.Service,
            emptyPersist({
              getTrail: (id) =>
                id.taskId === "task-1" && id.trailIdx === 0
                  ? Option.some(
                      Stream.empty.pipe(
                        Stream.concat(
                          Stream.succeed(
                            Event.TrailStartEvent.make({
                              harnessId: "test-harness",
                              benchId: "bench-1",
                              taskId: "task-1",
                              trailIdx: 0,
                            }),
                          ),
                        ),
                        Stream.concat(
                          Stream.succeed(
                            Event.TrailEndEvent.make({
                              harnessId: "test-harness",
                              benchId: "bench-1",
                              taskId: "task-1",
                              trailIdx: 0,
                              grade: { score: 9 },
                              usage: null,
                            }),
                          ),
                        ),
                        Stream.concat(
                          Stream.fromEffect(
                            Event.resultDone(
                              Event.TrailResult.make({ grade: { score: 9 }, sessions: [] }),
                            ),
                          ),
                        ),
                      ),
                    )
                  : Option.none(),
            }),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );

  it.effect("reports persistence sink failures as bench errors", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench();
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "BenchErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "EventError");
      }
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeRuntimeLayer(() => responseParts("answer")),
          Layer.succeed(
            Event.Persist.Service,
            emptyPersist({
              persist: () => Effect.fail(Event.EventError.send(new Error("sink failed"))),
            }),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );

  it.effect("persists every event and waits for the sink before returning a result", () =>
    Effect.gen(function* () {
      const persistedEvents = yield* Ref.make<Array<Event.EvalEvent>>([]);
      const sinkCompleted = yield* Ref.make(false);
      const bench = yield* makeBench();
      const captured = yield* runAndCapture(bench).pipe(
        Effect.provide(
          Layer.succeed(
            Event.Persist.Service,
            emptyPersist({
              persist: (stream) =>
                stream.pipe(
                  Stream.tap((event) =>
                    Ref.update(persistedEvents, (events) => [...events, event]),
                  ),
                  Stream.runDrain,
                  Effect.catch(() =>
                    Effect.promise(
                      () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
                    ).pipe(Effect.andThen(Ref.set(sinkCompleted, true))),
                  ),
                ),
            }),
          ),
        ),
      );

      assert.isTrue(yield* Ref.get(sinkCompleted));
      assert.deepStrictEqual(
        (yield* Ref.get(persistedEvents)).map((event) => event._tag),
        captured.events.map((event) => event._tag),
      );
      assert.deepStrictEqual(captured.result.tasks["task-1"]?.trails[0]?.grade, { score: 1 });
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("waits for a persistence failure when evaluation also fails", () =>
    Effect.gen(function* () {
      const sinkCompleted = yield* Ref.make(false);
      const bench = yield* makeBench({
        grade: async () => {
          throw new Error("grader failed before persistence");
        },
      });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(
        Stream.runCollect,
        Effect.provide(
          Layer.succeed(
            Event.Persist.Service,
            emptyPersist({
              persist: (stream) =>
                Stream.runDrain(stream).pipe(
                  Effect.catch(() =>
                    Effect.promise(
                      () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
                    ).pipe(
                      Effect.andThen(Ref.set(sinkCompleted, true)),
                      Effect.andThen(
                        Effect.fail(Event.EventError.send(new Error("delayed sink failure"))),
                      ),
                    ),
                  ),
                ),
            }),
          ),
        ),
      );

      assert.isTrue(yield* Ref.get(sinkCompleted));
      const errorEvent = events.find((event) => event._tag === "BenchErrorEvent");
      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent.error));
      if (Schema.is(Eval.EvalError)(errorEvent.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "EventError");
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("keeps every trail and feeds task and bench metrics", () =>
    Effect.gen(function* () {
      const taskMetric = yield* Metric.Task.make({
        id: "task-progress",
        exec: (results) => ({ count: results.length }),
      });
      const benchMetric = yield* Metric.Bench.make({
        id: "bench-progress",
        exec: (results) => ({ count: Object.keys(results).length }),
      });
      const bench = yield* makeBench({
        taskIds: ["task-1", "task-2"],
        taskMetrics: [taskMetric],
        benchMetrics: [benchMetric],
      });
      const { events, result } = yield* runAndCapture(bench, {
        trailCount: 3,
        trailConcurrency: 3,
      });

      assert.deepStrictEqual(
        ["task-1", "task-2"].map((id) => result.tasks[id]?.trails.length),
        [3, 3],
      );
      assert.strictEqual(events.filter((event) => event._tag === "TrailStartEvent").length, 6);
      assert.strictEqual(events.filter((event) => event._tag === "TrailEndEvent").length, 6);
      const taskMetricEvents = events.flatMap((event) =>
        event._tag === "TaskMetricEvent" ? [{ id: event.taskId, value: event.value }] : [],
      );
      assert.deepStrictEqual(
        taskMetricEvents
          .map(({ value }) => value)
          .map((value) => Schema.decodeUnknownSync(CountResult)(value).count)
          .sort((left, right) => left - right),
        [1, 1, 2, 2, 3, 3],
      );
      assert.deepStrictEqual(
        events
          .flatMap((event) => (event._tag === "BenchMetricEvent" ? [event.value] : []))
          .map((value) => Schema.decodeUnknownSync(CountResult)(value).count)
          .sort((left, right) => left - right),
        [1, 2],
      );
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("fans completed results out to every task and bench metric", () =>
    Effect.gen(function* () {
      const taskMetrics = yield* Effect.all(
        ["task-a", "task-b"].map((id) =>
          Metric.Task.make({ id, exec: (results) => results.length }),
        ),
      );
      const benchMetrics = yield* Effect.all(
        ["bench-a", "bench-b"].map((id) =>
          Metric.Bench.make({ id, exec: (results) => Object.keys(results).length }),
        ),
      );
      const bench = yield* makeBench({ taskMetrics, benchMetrics });
      const { events } = yield* runAndCapture(bench, {
        trailCount: 2,
        trailConcurrency: 2,
      });

      for (const id of ["task-a", "task-b"]) {
        assert.deepStrictEqual(
          events
            .flatMap((event) =>
              event._tag === "TaskMetricEvent" && event.id === id ? [event.value] : [],
            )
            .map((value) => Schema.decodeUnknownSync(Schema.Number)(value)),
          [1, 2],
        );
      }
      for (const id of ["bench-a", "bench-b"]) {
        assert.deepStrictEqual(
          events
            .flatMap((event) =>
              event._tag === "BenchMetricEvent" && event.id === id ? [event.value] : [],
            )
            .map((value) => Schema.decodeUnknownSync(Schema.Number)(value)),
          [1],
        );
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("orders aggregate trails by trail index rather than completion time", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench({
        grade: async ({ trajectory }) => {
          const isFirstTrail = JSON.stringify(trajectory).includes("trail-0");
          if (isFirstTrail) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          return { score: isFirstTrail ? 0 : 1 };
        },
      });
      const { events, result } = yield* runAndCapture(bench, {
        trailCount: 2,
        trailConcurrency: 2,
      });

      assert.deepStrictEqual(
        events.filter((event) => event._tag === "TrailEndEvent").map((event) => event.trailIdx),
        [1, 0],
      );
      assert.deepStrictEqual(
        result.tasks["task-1"]?.trails.map((trail) => trail.grade),
        [{ score: 0 }, { score: 1 }],
      );
    }).pipe(
      Effect.provide(makeRuntimeLayer((sessionIdx) => responseParts(`trail-${sessionIdx}`))),
      Effect.scoped,
    ),
  );

  it.effect("supports a zero-trail task without manufacturing a trail", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench();
      const { events, result } = yield* runAndCapture(bench, { trailCount: 0 });

      assert.deepStrictEqual(result.tasks["task-1"]?.trails, []);
      assert.strictEqual(events.filter((event) => event._tag === "TrailStartEvent").length, 0);
      assert.strictEqual(events.filter((event) => event._tag === "TaskStartEvent").length, 1);
      assert.strictEqual(events.filter((event) => event._tag === "TaskEndEvent").length, 1);
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("treats negative trail counts as an empty trail set", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench();
      const { events, result } = yield* runAndCapture(bench, { trailCount: -2 });

      assert.deepStrictEqual(result.tasks["task-1"]?.trails, []);
      assert.strictEqual(events.filter((event) => event._tag === "TrailStartEvent").length, 0);
      assert.strictEqual(events.filter((event) => event._tag === "TaskEndEvent").length, 1);
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("rejects invalid concurrency and trail counts without hanging", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench();
      const invalidConfigs = [
        { trailConcurrency: 0 },
        { trailConcurrency: -1 },
        { trailConcurrency: Number.MAX_SAFE_INTEGER + 1 },
        { snapshotConcurrency: 0 },
        { snapshotConcurrency: 1.5 },
        { trailCount: 1.5 },
        { trailCount: Number.NaN },
        { trailCount: Number.POSITIVE_INFINITY },
        { trailCount: Number.MAX_SAFE_INTEGER + 1 },
      ];

      for (const config of invalidConfigs) {
        const events = yield* Eval.stream(Eval.run(bench, config)).pipe(Stream.runCollect);
        assert.strictEqual(events.length, 1);
        const errorEvent = events[0];
        assert.strictEqual(errorEvent?._tag, "BenchErrorEvent");
        if (errorEvent?._tag === "BenchErrorEvent") {
          assert.isTrue(Schema.is(Eval.EvalError)(errorEvent.error));
          if (Schema.is(Eval.EvalError)(errorEvent.error)) {
            assert.strictEqual(errorEvent.error.reason._tag, "InitFailed");
          }
        }
      }
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );

  it.effect("completes an empty benchmark without starting task workers", () =>
    Effect.gen(function* () {
      const bench = yield* Bench.make(
        "empty-bench",
        Effect.succeed([] as ReadonlyArray<Task.AnyTask>),
      );
      const { events, result } = yield* runAndCapture(bench);

      assert.deepStrictEqual(result.tasks, {});
      assert.deepStrictEqual(
        events.map((event) => event._tag),
        ["BenchStartEvent", "BenchEndEvent"],
      );
    }).pipe(Effect.provide(makeRuntimeLayer(() => responseParts("answer"))), Effect.scoped),
  );
});
