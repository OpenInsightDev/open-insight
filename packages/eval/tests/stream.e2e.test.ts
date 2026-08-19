import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  Agent,
  Harness,
  Response,
  Sandbox,
  Snapshot as CoreSnapshot,
} from "@open-insight/core/internal";
import { Bench, Eval, Grade, Task } from "@open-insight/eval";
import { Brand, Cause, Effect, Layer, Option, Schema, Stream } from "effect";

const GradeResult = Schema.Struct({ score: Schema.Number });

const responseParts = (text: string): ReadonlyArray<Response.StreamPartEncoded> => [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: text },
  { type: "text-end", id: "text" },
  {
    type: "finish",
    reason: "stop",
    usage: {
      inputTokens: { total: 3 },
      outputTokens: { total: 5 },
    },
  },
];

const template = CoreSnapshot.Alpine;
const snapshot = Brand.nominal<CoreSnapshot.Snapshot>()({ name: "open-insight/eval-e2e" });

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

const makeRuntimeLayer = () => {
  const sandboxProvider = {
    acquireSnapshot: () => Effect.succeed(snapshot),
    deriveSnapshot: () => Effect.succeed(snapshot),
    runSandbox: () => Effect.succeed(sandbox),
  } satisfies Sandbox.Provider;

  const agentLayer = Layer.effect(
    Agent.ProviderService,
    Agent.make({
      snapshotExtension: Option.none(),
      runSession: () =>
        Effect.succeed({ prompt: () => Stream.fromIterable(responseParts("answer")) }),
    }),
  );

  const providerLayers = Layer.mergeAll(
    Layer.succeed(Sandbox.ProviderService)(sandboxProvider),
    agentLayer,
  );
  const harnessLayer = Harness.Service.layer("stream-e2e-harness").pipe(
    Layer.provide(providerLayers),
  );

  return Layer.mergeAll(harnessLayer, providerLayers, NodeServices.layer);
};

const makeBench = Effect.fn(function* (
  options: Readonly<{
    taskIds?: ReadonlyArray<string>;
    grade?: () => PromiseLike<{ score: number }>;
  }> = {},
) {
  const grade = options.grade ?? (async () => ({ score: 1 }));
  const tasks = yield* Effect.all(
    (options.taskIds ?? ["task-1"]).map((id) =>
      Task.make(GradeResult)({
        id,
        snapshot: template,
        prompt: { init: "solve" },
        grader: Grade.embed(grade),
      }),
    ),
  );
  return yield* Bench.make("stream-e2e-bench", Effect.succeed(tasks));
});

describe("public evaluation stream API", () => {
  it.effect("runs a complete evaluation through run, stream, and result", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench();
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const result = yield* Eval.run(bench).pipe(Eval.result);

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
      assert.deepStrictEqual(result.tasks["task-1"]?.trails[0]?.grade, { score: 1 });
      assert.strictEqual(result.tasks["task-1"]?.trails[0]?.sessions.length, 1);
    }).pipe(Effect.provide(makeRuntimeLayer()), Effect.scoped),
  );

  it.effect("preserves events and results for multiple tasks and trails", () =>
    Effect.gen(function* () {
      const bench = yield* makeBench({ taskIds: ["task-a", "task-b"] });
      const events = yield* Eval.stream(Eval.run(bench, { trailCount: 2 })).pipe(Stream.runCollect);
      const result = yield* Eval.run(bench, { trailCount: 2 }).pipe(Eval.result);

      const trailStarts = events.filter((event) => event._tag === "TrailStartEvent");
      const trailEnds = events.filter((event) => event._tag === "TrailEndEvent");
      assert.strictEqual(trailStarts.length, 4);
      assert.strictEqual(trailEnds.length, 4);
      assert.deepStrictEqual(
        trailStarts.map((event) => `${event.id.taskId}:${event.id.trailIdx}`).sort(),
        ["task-a:0", "task-a:1", "task-b:0", "task-b:1"],
      );
      assert.deepStrictEqual(Object.keys(result.tasks).sort(), ["task-a", "task-b"]);
      for (const taskId of ["task-a", "task-b"]) {
        assert.strictEqual(result.tasks[taskId]?.trails.length, 2);
        assert.deepStrictEqual(
          result.tasks[taskId]?.trails.map((trail) => trail.grade),
          [{ score: 1 }, { score: 1 }],
        );
      }
    }).pipe(Effect.provide(makeRuntimeLayer()), Effect.scoped),
  );

  it.effect("turns typed grader failures into events and fails result", () =>
    Effect.gen(function* () {
      const failingGrade = async () => {
        throw new Error("grader failed");
      };
      const bench = yield* makeBench({ grade: failingGrade });
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "TrailErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "GradeError");
      }

      const resultExit = yield* Effect.exit(Eval.run(bench).pipe(Eval.result));
      assert.strictEqual(resultExit._tag, "Failure");
      if (resultExit._tag === "Failure") {
        const reason = resultExit.cause.reasons[0];
        assert.isTrue(Cause.isFailReason(reason));
        if (Cause.isFailReason(reason)) {
          assert.strictEqual(reason.error._tag, "EvalError");
          assert.strictEqual(reason.error.reason._tag, "GradeError");
        }
      }
    }).pipe(Effect.provide(makeRuntimeLayer()), Effect.scoped),
  );

  it.effect("rejects a grader payload that violates its declared schema", () =>
    Effect.gen(function* () {
      const task = yield* Task.make(GradeResult)({
        id: "invalid-grade-task",
        snapshot: template,
        prompt: { init: "solve" },
        // JSON.parse models an untrusted grader boundary; validation belongs to
        // the declared GradeResult schema, not to this fixture.
        grader: Grade.embed(async () => JSON.parse('{"score":"not-a-number"}')),
      });
      const bench = yield* Bench.make("invalid-grade-bench", Effect.succeed([task]));
      const events = yield* Eval.stream(Eval.run(bench)).pipe(Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "TrailErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "GradeError");
        if (errorEvent.error.reason._tag === "GradeError") {
          assert.strictEqual(errorEvent.error.reason.reason._tag, "InvalidResult");
        }
      }
    }).pipe(Effect.provide(makeRuntimeLayer()), Effect.scoped),
  );
});
