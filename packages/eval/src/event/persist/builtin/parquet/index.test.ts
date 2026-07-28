import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { Error as EventError } from "../../../error.ts";
import { EvalScheduleEvent, type Event } from "../../../schema.ts";
import { make, replay } from "./index.ts";

const event = (op: "start" | "stop" | "pause") =>
  new EvalScheduleEvent({ bench: "bench", harness: "harness", op });

const operations = (events: ReadonlyArray<Event>) =>
  events.flatMap((item) => (item._tag === "EvalScheduleEvent" ? [item.op] : []));

layer(NodeServices.layer)((it) => {
  it.effect("writes and replays a complete event stream", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const filePath = path.join(directory, "events.parquet");
      const transport = yield* make({ filePath });

      yield* transport.send(Stream.make(event("start"), event("pause"), event("stop")));

      assert.isTrue(yield* fs.exists(filePath));
      const events = yield* Stream.runCollect(replay({ filePath }));
      assert.deepStrictEqual(operations(events), ["start", "pause", "stop"]);
    }),
  );

  it.effect("replaces the previous completed stream", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const filePath = path.join(directory, "events.parquet");
      const transport = yield* make({ filePath });

      yield* transport.send(Stream.make(event("start"), event("pause")));
      yield* transport.send(Stream.make(event("stop")));

      const events = yield* Stream.runCollect(replay({ filePath }));
      assert.deepStrictEqual(operations(events), ["stop"]);
    }),
  );

  it.effect("writes a valid empty parquet file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const filePath = path.join(directory, "events.parquet");
      const transport = yield* make({ filePath });

      yield* transport.send(Stream.empty);

      assert.strictEqual((yield* Stream.runCollect(replay({ filePath }))).length, 0);
    }),
  );

  it.effect("does not replace the destination when the input stream fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const filePath = path.join(directory, "events.parquet");
      const transport = yield* make({ filePath });
      yield* transport.send(Stream.make(event("start")));

      const failure = EventError.invalid(new globalThis.Error("stream failed"));
      const failedStream = Stream.concat(Stream.make(event("stop")), Stream.fail(failure));
      const error = yield* transport.send(failedStream).pipe(Effect.flip);

      assert.strictEqual(error, failure);
      const events = yield* Stream.runCollect(replay({ filePath }));
      assert.deepStrictEqual(operations(events), ["start"]);
    }),
  );
});
