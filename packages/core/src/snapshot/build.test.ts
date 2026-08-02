import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import * as Sandbox from "../sandbox/index.ts";
import * as Snapshot from "./index.ts";

describe("Snapshot", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("constructs an image-only snapshot from a string", () =>
      Effect.sync(() => {
        const snapshot = Snapshot.make("alpine:3.22");

        assert.strictEqual(snapshot._tag, "Instructions");
        assert.strictEqual(snapshot.image, "alpine:3.22");
        assert.strictEqual(snapshot.context, "/tmp");
        assert.deepStrictEqual(snapshot.instructions, [Snapshot.Inst.cmd("sleep", "infinity")]);
      }),
    );

    it.effect("constructs and encodes provider-independent instructions", () =>
      Effect.sync(() => {
        const snapshot = Snapshot.makeWith({
          image: "alpine:3.22",
          context: "/workspace",
          instructions: [
            Snapshot.Inst.env({ B: "second", A: "first" }),
            Snapshot.Inst.run("echo ready"),
            Snapshot.Inst.cmd(
              "acp-agent",
              "serve",
              "codex-acp",
              "--host",
              "0.0.0.0",
              "--port",
              "8010",
            ),
          ],
        });

        assert.strictEqual(snapshot._tag, "Instructions");
        assert.strictEqual(
          Snapshot.encode(snapshot),
          'FROM alpine:3.22\nENV A="first" B="second"\nRUN echo ready\nCMD ["acp-agent","serve","codex-acp","--host","0.0.0.0","--port","8010"]\nCMD ["sleep","infinity"]\n',
        );
      }),
    );

    it.effect("keeps a local Containerfile without decoding it", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const context = yield* fs.makeTempDirectoryScoped();
          const filePath = path.join(context, "Containerfile");
          yield* fs.writeFileString(
            filePath,
            "# syntax=docker/dockerfile:1\nFROM alpine\nRUN --mount=type=cache,target=/var/cache echo ready\n",
          );

          const snapshot = yield* Snapshot.build({ filePath });

          assert.strictEqual(snapshot._tag, "Containerfile");
          assert.strictEqual(snapshot.filePath, yield* fs.realPath(filePath));
          assert.strictEqual(snapshot.context, yield* fs.realPath(context));
          assert.strictEqual(
            yield* fs.readFileString(filePath),
            '# syntax=docker/dockerfile:1\nFROM alpine\nRUN --mount=type=cache,target=/var/cache echo ready\nCMD ["sleep","infinity"]\n',
          );

          const error = Sandbox.Error.buildUnsupported("remote", snapshot);
          const reason = error.reason;
          if (reason._tag !== "SnapshotBuildUnsupported") {
            return assert.fail(`Unexpected error reason: ${reason._tag}`);
          }
          assert.strictEqual(reason.name, "remote");
          assert.strictEqual(reason.snapshot.filePath, snapshot.filePath);
          assert.strictEqual(reason.snapshot.context, snapshot.context);
          assert.strictEqual(
            error.message,
            'Sandbox provider "remote" does not support Containerfile snapshots',
          );
          assert.strictEqual(error.cause, reason);
        }),
      ),
    );
  });
});
