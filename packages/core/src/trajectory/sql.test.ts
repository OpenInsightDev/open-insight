import { ClickhouseClient } from "@effect/sql-clickhouse";
import { assert, it } from "@effect/vitest";
import { createChdbConnection } from "chdb/connection";
import { Effect, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { load, TrajectoryId } from "./sql.ts";

const layer = () =>
  ClickhouseClient.layer({
    // chdb 3.3.0 exports the 1.23.0 client-common contract, while its
    // @clickhouse/client 1.23.1 peer bundles the same contract with newer settings.
    // @ts-expect-error The official connection is runtime-compatible despite that declaration skew.
    connection: createChdbConnection({ path: ":memory:" }),
  });

it.effect("loads a paginated trajectory from chDB", () =>
  Effect.gen(function* () {
    const clickhouse = yield* ClickhouseClient.ClickhouseClient;
    const sql = yield* SqlClient.SqlClient;

    yield* clickhouse.asCommand(
      sql.unsafe(`
      CREATE TABLE trajectoryParts (
        id UInt32,
        trajectoryId String,
        seq Int32,
        payload Variant(JSON, Array(JSON)),
        createdAt DateTime64(3)
      ) ENGINE = MergeTree
      ORDER BY (trajectoryId, seq)
    `),
    );

    yield* clickhouse.insertQuery({
      table: "trajectoryParts",
      values: [
        {
          id: 3,
          trajectoryId: "trajectory-1",
          seq: 3,
          payload: { type: "text-delta", id: "answer", delta: "Hello" },
          createdAt: "2026-08-28 00:00:00.000",
        },
        {
          id: 6,
          trajectoryId: "trajectory-2",
          seq: 1,
          payload: [{ role: "user", content: "Not this trajectory" }],
          createdAt: "2026-08-28 00:00:00.000",
        },
        {
          id: 1,
          trajectoryId: "trajectory-1",
          seq: 1,
          payload: [{ role: "user", content: "Question" }],
          createdAt: "2026-08-28 00:00:00.000",
        },
        {
          id: 5,
          trajectoryId: "trajectory-1",
          seq: 5,
          payload: [{ role: "user", content: "Follow-up" }],
          createdAt: "2026-08-28 00:00:00.000",
        },
        {
          id: 2,
          trajectoryId: "trajectory-1",
          seq: 2,
          payload: { type: "text-start", id: "answer" },
          createdAt: "2026-08-28 00:00:00.000",
        },
        {
          id: 4,
          trajectoryId: "trajectory-1",
          seq: 4,
          payload: { type: "text-end", id: "answer" },
          createdAt: "2026-08-28 00:00:00.000",
        },
      ],
    });

    const trajectory = yield* load(TrajectoryId.make("trajectory-1"), { pageSize: 2 });
    const parts = yield* trajectory.parts.pipe(Stream.runCollect);

    assert.deepStrictEqual(
      parts.map((part) => part._tag),
      ["Prompt", "Response", "Prompt"],
    );

    const first = parts[0];
    assert.strictEqual(first?._tag, "Prompt");
    if (first?._tag === "Prompt") {
      const message = first.messages[0];
      assert.strictEqual(message?.role, "user");
      if (message?.role === "user") {
        const content = message.content[0];
        assert.strictEqual(content?.type, "text");
        if (content?.type === "text") {
          assert.strictEqual(content.text, "Question");
        }
      }
    }

    const response = parts[1];
    assert.strictEqual(response?._tag, "Response");
    if (response?._tag === "Response" && response.response.type === "text") {
      assert.strictEqual(response.response.text, "Hello");
    }

    const followUp = parts[2];
    assert.strictEqual(followUp?._tag, "Prompt");
    if (followUp?._tag === "Prompt") {
      const message = followUp.messages[0];
      assert.strictEqual(message?.role, "user");
      if (message?.role === "user") {
        const content = message.content[0];
        assert.strictEqual(content?.type, "text");
        if (content?.type === "text") {
          assert.strictEqual(content.text, "Follow-up");
        }
      }
    }
  }).pipe(Effect.provide(layer())),
);
