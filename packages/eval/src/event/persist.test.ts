import { assert, it } from "@effect/vitest";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { Persistence } from "effect/unstable/persistence";
import { EvalScheduleEvent, type Event } from "./schema.ts";
import { make } from "./persist.ts";

const event = (op: "start" | "stop" | "pause") =>
  new EvalScheduleEvent({ bench: "bench", harness: "harness", op });

const operations = (events: ReadonlyArray<Event>) =>
  events.flatMap((item) => (item._tag === "EvalScheduleEvent" ? [item.op] : []));

it.layer(Layer.merge(Persistence.layerBackingMemory, NodeCrypto.layer))("EventJournal", (it) => {
  it.effect("persists, reopens, and replays events in order", () =>
    Effect.gen(function* () {
      const first = yield* make({ storeId: "replay" });
      yield* first.write(Stream.make(event("start"), event("pause")));

      const reopened = yield* make({ storeId: "replay" });
      assert.strictEqual(yield* reopened.size, 2);
      assert.strictEqual(yield* reopened.append(event("stop")), 2);

      const replayed = yield* Stream.runCollect(reopened.replay);
      assert.deepStrictEqual(operations(replayed), ["start", "pause", "stop"]);
    }),
  );

  it.effect("isolates journals by store id and clears only the selected journal", () =>
    Effect.gen(function* () {
      const first = yield* make({ storeId: "first" });
      const second = yield* make({ storeId: "second" });
      yield* first.append(event("start"));
      yield* second.append(event("stop"));

      yield* first.clear;

      assert.strictEqual(yield* first.size, 0);
      assert.strictEqual(yield* second.size, 1);
      assert.deepStrictEqual(operations(yield* Stream.runCollect(second.replay)), ["stop"]);
    }),
  );

  it.effect("fails replay when a committed event is missing", () =>
    Effect.gen(function* () {
      const journal = yield* make({ storeId: "corrupted" });
      yield* journal.write(Stream.make(event("start"), event("stop")));

      const backing = yield* Persistence.BackingPersistence;
      const store = yield* backing.make("corrupted");
      yield* store.remove("event:1");

      const error = yield* Stream.runCollect(journal.replay).pipe(Effect.flip);
      assert.strictEqual(error._tag, "EventJournalError");
      assert.strictEqual(error.operation, "replay");
      assert.strictEqual(error.sequence, 1);
    }),
  );

  it.effect("adapts the journal to EventTransport", () =>
    Effect.gen(function* () {
      const journal = yield* make({ storeId: "transport" });
      yield* journal.transport.send(Stream.make(event("start"), event("stop")));

      assert.strictEqual(yield* journal.size, 2);
    }),
  );

  it.effect("serializes concurrent appends within one journal instance", () =>
    Effect.gen(function* () {
      const journal = yield* make({ storeId: "concurrent" });
      const sequences = yield* Effect.forEach(
        [event("start"), event("pause"), event("stop")],
        journal.append,
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(
        sequences.toSorted((left, right) => left - right),
        [0, 1, 2],
      );
      assert.strictEqual((yield* Stream.runCollect(journal.replay)).length, 3);
    }),
  );
});
