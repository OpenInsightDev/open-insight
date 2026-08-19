import { assert, describe, it } from "@effect/vitest";
import { Eval } from "@open-insight/eval";
import { Effect, Equal, Schema, Stream } from "effect";
import * as Event from "../src/event/index.ts";
import * as Task from "../src/task/index.ts";
import {
  makeResultSink,
  makeSessionResultSink,
  makeTaskResultSink,
  makeTrailResultSink,
} from "../src/eval/result.ts";
import { makeBench, makeRuntime } from "./stream-fixture.ts";

describe("evaluation result sink", () => {
  it.effect("rebuilds nested results from interleaved session event streams", () => {
    const fixture = makeRuntime();

    return Effect.gen(function* () {
      const bench = yield* makeBench({ taskIds: ["task-a", "task-b"] });
      const options = { trailCount: 2, trailConcurrency: 4, snapshotConcurrency: 2 } as const;
      const events = yield* Eval.run(bench, options).pipe(Eval.stream, Stream.runCollect);
      const id = {
        benchId: bench.metadata.id,
        harnessId: "stream-test-harness",
      };
      const sessionStart = Array.from(events).find(Schema.is(Event.SessionStartEvent));
      assert.isDefined(sessionStart);

      const sameSession = Schema.toEquivalence(Event.SessionID);
      const sameTrail = Schema.toEquivalence(Event.TrailID);
      const sameTask = Schema.toEquivalence(Event.TaskID);
      const sessionEvents = Array.from(events)
        .filter(Schema.is(Event.SessionEvent))
        .filter((event) => sameSession(event.id, sessionStart.id));
      const trailEvents = Array.from(events)
        .filter(Schema.is(Event.TrailEvent))
        .filter((event) => sameTrail(event.id, sessionStart.id));
      const taskEvents = Array.from(events)
        .filter(Schema.is(Event.TaskEvent))
        .filter((event) => sameTask(event.id, sessionStart.id));

      const session = yield* Stream.fromIterable(sessionEvents).pipe(
        Stream.run(makeSessionResultSink(sessionStart.id)),
      );
      const trail = yield* Stream.fromIterable(trailEvents).pipe(
        Stream.run(makeTrailResultSink(sessionStart.id)),
      );
      const task = yield* Stream.fromIterable(taskEvents).pipe(
        Stream.run(makeTaskResultSink(sessionStart.id)),
      );

      const result = yield* Stream.fromIterable(events).pipe(
        Stream.run(makeResultSink<Task.AnyTask>(id)),
      );

      assert.strictEqual(session.id.sessionIdx, sessionStart.id.sessionIdx);
      assert.deepStrictEqual(trail.sessions, [session]);
      assert.deepStrictEqual(
        task.trails.find((result) => sameTrail(result.id, trail.id)),
        trail,
      );
      assert.deepStrictEqual(Object.keys(result.tasks).sort(), ["task-a", "task-b"]);
      for (const task of Object.values(result.tasks)) {
        assert.strictEqual(task.trails.length, 2);
        for (const trail of task.trails) {
          assert.strictEqual(trail.sessions.length, 1);
          assert.strictEqual(trail.sessions[0]?.trajectory.content.length, 2);
        }
      }

      const benchStart = events.find((event) => event._tag === "BenchStartEvent");
      const benchEnd = events.find((event) => event._tag === "BenchEndEvent");
      assert.isDefined(benchStart);
      assert.isDefined(benchEnd);
      assert.isTrue(Equal.equals(result.startedAt, benchStart?.startAt));
      assert.isTrue(Equal.equals(result.finishedAt, benchEnd?.endAt));
    }).pipe(Effect.provide(fixture.runtime), Effect.scoped);
  });
});
