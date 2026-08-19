import { assert, describe, it } from "@effect/vitest";
import { Bench, Eval, Grade, Task } from "@open-insight/eval";
import { Prompt } from "@open-insight/core/internal";
import { Cause, Effect, Schema, Stream } from "effect";
import { GradeResult, makeBench, makeRuntime, template } from "./stream-fixture.ts";

const eventTags = <A extends { readonly _tag: string }>(events: Iterable<A>) =>
  Array.from(events, (event) => event._tag);

describe("evaluation stream end to end", () => {
  it.effect("runs the public stream and result APIs through a complete evaluation", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* makeBench();
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const result = yield* Eval.run(bench).pipe(Eval.result);

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

      const sessionEnd = events.find((event) => event._tag === "SessionEndEvent");
      assert.isDefined(sessionEnd);
      if (sessionEnd?._tag === "SessionEndEvent") {
        assert.strictEqual(sessionEnd.reason, "stop");
        assert.strictEqual(sessionEnd.usage?.outputTokens.total, 5);
      }

      const task = result.tasks["task-1"];
      assert.isDefined(task);
      assert.strictEqual(task?.trails.length, 1);
      assert.deepStrictEqual(task?.trails[0]?.grade, { score: 1 });
      assert.strictEqual(task?.trails[0]?.sessions.length, 1);
      assert.strictEqual(task?.trails[0]?.sessions[0]?.trajectory.content.length, 2);
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("aggregates every task and trail without imposing cross-branch event order", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* makeBench({ taskIds: ["task-a", "task-b"] });
      const options = { trailCount: 3, trailConcurrency: 2, snapshotConcurrency: 2 } as const;
      const events = yield* Eval.run(bench, options).pipe(Eval.stream, Stream.runCollect);
      const result = yield* Eval.run(bench, options).pipe(Eval.result);

      const trailStarts = events.filter((event) => event._tag === "TrailStartEvent");
      const trailEnds = events.filter((event) => event._tag === "TrailEndEvent");
      assert.strictEqual(trailStarts.length, 6);
      assert.strictEqual(trailEnds.length, 6);
      assert.deepStrictEqual(
        trailStarts.map((event) => `${event.id.taskId}:${event.id.trailIdx}`).sort(),
        ["task-a:0", "task-a:1", "task-a:2", "task-b:0", "task-b:1", "task-b:2"],
      );

      assert.deepStrictEqual(Object.keys(result.tasks).sort(), ["task-a", "task-b"]);
      for (const taskId of ["task-a", "task-b"]) {
        assert.strictEqual(result.tasks[taskId]?.trails.length, 3);
        assert.deepStrictEqual(
          result.tasks[taskId]?.trails.map((trail) => trail.id.trailIdx).sort(),
          [0, 1, 2],
        );
      }
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("surfaces a grader exception as an event and as the result failure", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* makeBench({
        grade: async () => {
          throw new Error("grader failed");
        },
      });
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "TrailErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (Schema.is(Eval.EvalError)(errorEvent?.error)) {
        assert.strictEqual(errorEvent.error.reason._tag, "GradeError");
      }

      const exit = yield* Effect.exit(Eval.run(bench).pipe(Eval.result));
      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find(Cause.isFailReason);
        assert.isDefined(failure);
        if (failure !== undefined && Cause.isFailReason(failure)) {
          assert.strictEqual(failure.error._tag, "EvalError");
          assert.strictEqual(failure.error.reason._tag, "GradeError");
        }
      }
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("rejects a grader value outside its declared schema", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const task = yield* Task.make(GradeResult)({
        id: "invalid-grade",
        snapshot: template,
        prompt: { init: "solve" },
        grader: Grade.embed(async () => JSON.parse('{"score":"invalid"}')),
      });
      const bench = yield* Bench.make("invalid-grade-bench", Effect.succeed([task]));
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const errorEvent = events.find((event) => event._tag === "TrailErrorEvent");

      assert.isDefined(errorEvent);
      assert.isTrue(Schema.is(Eval.EvalError)(errorEvent?.error));
      if (
        Schema.is(Eval.EvalError)(errorEvent?.error) &&
        errorEvent.error.reason._tag === "GradeError"
      ) {
        assert.strictEqual(errorEvent.error.reason.reason._tag, "InvalidResult");
      }
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("completes an empty benchmark with an empty result", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* Bench.make("empty-bench", Effect.succeed([]));
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const result = yield* Eval.run(bench).pipe(Eval.result);

      assert.deepStrictEqual(eventTags(events), ["BenchStartEvent", "BenchEndEvent"]);
      assert.deepStrictEqual(result.tasks, {});
      assert.strictEqual(fixture.state.sessions, 0);
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("honors a zero trail count without starting an agent", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* makeBench();
      const events = yield* Eval.run(bench, { trailCount: 0 }).pipe(Eval.stream, Stream.runCollect);
      const result = yield* Eval.run(bench, { trailCount: 0 }).pipe(Eval.result);

      assert.deepStrictEqual(eventTags(events), [
        "BenchStartEvent",
        "TaskStartEvent",
        "TaskEndEvent",
        "BenchEndEvent",
      ]);
      assert.deepStrictEqual(result.tasks["task-1"]?.trails, []);
      assert.strictEqual(fixture.state.sessions, 0);
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("retries a grade by continuing the existing agent session", () => {
    const fixture = makeRuntime();
    let attempts = 0;

    return Effect.gen(function* () {
      const bench = yield* makeBench({
        grade: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Grade.retry({
              type: "continue",
              prompt: Prompt.make("try again"),
              reason: "retry once",
            });
          }
          return { score: 2 };
        },
      });
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const retry = events.find((event) => event._tag === "SessionRetryEvent");
      const starts = events.filter((event) => event._tag === "SessionStartEvent");

      assert.strictEqual(fixture.state.sessions, 1);
      assert.strictEqual(starts.length, 2);
      assert.deepStrictEqual(
        starts.map((event) => event.id.sessionIdx),
        [0, 1],
      );
      assert.isDefined(retry);
      if (retry?._tag === "SessionRetryEvent") {
        assert.strictEqual(retry.id.sessionIdx, 0);
        assert.strictEqual(retry.reason, "retry once");
      }
      const end = events.find((event) => event._tag === "TrailEndEvent");
      assert.deepStrictEqual(end?._tag === "TrailEndEvent" ? end.grade : undefined, { score: 2 });

      attempts = 0;
      const result = yield* Eval.run(bench).pipe(Eval.result);
      assert.deepStrictEqual(result.tasks["task-1"]?.trails[0]?.grade, { score: 2 });
      assert.strictEqual(result.tasks["task-1"]?.trails[0]?.sessions.length, 2);
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("retries a grade by restarting the agent session", () => {
    const fixture = makeRuntime();
    let attempts = 0;

    return Effect.gen(function* () {
      const bench = yield* makeBench({
        grade: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Grade.retry({
              type: "restart",
              prompt: Prompt.make("start over"),
              reason: "restart once",
            });
          }
          return { score: 3 };
        },
      });
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const retry = events.find((event) => event._tag === "SessionRetryEvent");

      assert.strictEqual(fixture.state.sessions, 2);
      assert.isDefined(retry);
      assert.deepStrictEqual(
        events
          .filter((event) => event._tag === "SessionStartEvent")
          .map((event) => event.id.sessionIdx),
        [0, 1],
      );
      const end = events.find((event) => event._tag === "TrailEndEvent");
      assert.deepStrictEqual(end?._tag === "TrailEndEvent" ? end.grade : undefined, { score: 3 });

      attempts = 0;
      const result = yield* Eval.run(bench).pipe(Eval.result);
      assert.deepStrictEqual(result.tasks["task-1"]?.trails[0]?.grade, { score: 3 });
      assert.strictEqual(result.tasks["task-1"]?.trails[0]?.sessions.length, 2);
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });

  it.effect("continues prompting until the prompt generator returns none", () => {
    const observed: Array<number> = [];
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* makeBench({
        prompt: {
          init: "first turn",
          fn: () => async (trajectory) => {
            observed.push(trajectory.content.length);
            return trajectory.content.length === 2 ? "second turn" : null;
          },
        },
      });
      const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect);
      const result = yield* Eval.run(bench).pipe(Eval.result);

      assert.strictEqual(events.filter((event) => event._tag === "SessionPromptEvent").length, 2);
      assert.deepStrictEqual(observed.slice(0, 2), [2, 4]);
      assert.strictEqual(
        result.tasks["task-1"]?.trails[0]?.sessions[0]?.trajectory.content.length,
        4,
      );
      assert.strictEqual(fixture.state.prompts.length, 4);
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });
});
