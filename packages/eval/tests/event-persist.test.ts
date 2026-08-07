import { assert, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { EventJournal, SqlEventJournal } from "effect/unstable/eventlog";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Event } from "../src/export.ts";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

const dbFile = path.join(os.tmpdir(), `event-persist-${process.pid}-${Date.now()}.db`);

it("persists the event stream to a local sqlite file", () =>
  Effect.gen(function* () {
    const persist = yield* Event.Persist.Service;

    yield* persist.send(
      Stream.make(
        new Event.EvalScheduleEvent({ bench: "bench-a", harness: "harness-b", op: "start" }),
        new Event.TaskScheduleEvent({
          bench: "bench-a",
          harness: "harness-b",
          task: "task-c",
          op: "pause",
        }),
      ),
    );

    const entries = yield* (yield* EventJournal.EventJournal).entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].event, "EvalScheduleEvent");
    assert.equal(entries[1].event, "TaskScheduleEvent");
    assert.equal(fs.existsSync(dbFile), true);
  }).pipe(
    Effect.provide(Layer.effect(Event.Persist.Service)(Event.Persist.make())),
    Effect.provide(SqlEventJournal.layer()),
    Effect.provide(SqliteClient.layer({ filename: dbFile })),
    Effect.ensuring(Effect.sync(() => fs.rmSync(dbFile, { force: true }))),
  ));
