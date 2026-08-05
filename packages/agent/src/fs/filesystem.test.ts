import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { MemFs } from "./memfs.ts";
import * as Fs from "./filesystem.ts";

describe("MemFs FileSystem", () => {
  layer(Fs.layer)((it) => {
    it.effect("writes and reads files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/hello.txt", "hello world");
        assert.strictEqual(yield* fs.readFileString("/hello.txt"), "hello world");
        assert.isTrue(yield* fs.exists("/hello.txt"));
        assert.isFalse(yield* fs.exists("/missing.txt"));
      }),
    );

    it.effect("reads and writes binary data", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const data = new TextEncoder().encode("binary");
        yield* fs.writeFile("/bin.dat", data);
        const out = yield* fs.readFile("/bin.dat");
        assert.deepStrictEqual(out, data);
        assert.strictEqual(new TextDecoder().decode(out), "binary");
      }),
    );

    it.effect("creates directories and lists entries", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory("/workspace/src", { recursive: true });
        yield* fs.writeFileString("/workspace/a.txt", "a");
        yield* fs.writeFileString("/workspace/src/b.txt", "b");

        assert.deepStrictEqual(yield* fs.readDirectory("/workspace"), ["a.txt", "src"]);
        assert.deepStrictEqual(yield* fs.readDirectory("/workspace", { recursive: true }), [
          "a.txt",
          "src/b.txt",
          "src",
        ]);

        const info = yield* fs.stat("/workspace/src");
        assert.strictEqual(info.type, "Directory");
        assert.strictEqual(info.size, FileSystem.Size(0));
        const file = yield* fs.stat("/workspace/a.txt");
        assert.strictEqual(file.type, "File");
        assert.strictEqual(file.size, FileSystem.Size(1));
      }),
    );

    it.effect("reports normalized errors for missing paths", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const error = yield* fs.readFileString("/missing.txt").pipe(Effect.flip);
        assert.strictEqual(error.reason._tag, "NotFound");

        yield* fs.makeDirectory("/dup");
        const dup = yield* fs.makeDirectory("/dup").pipe(Effect.flip);
        assert.strictEqual(dup.reason._tag, "AlreadyExists");
      }),
    );

    it.effect("supports open file handles", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString("/file.txt", "hello");

          const file = yield* fs.open("/file.txt", { flag: "r+" });
          const stat = yield* file.stat;
          assert.strictEqual(stat.size, FileSystem.Size(5));

          yield* file.seek(FileSystem.Size(1), "start");
          const read = yield* file.readAlloc(FileSystem.Size(4));
          assert.deepStrictEqual(read, Option.some(new TextEncoder().encode("ello")));
          assert.deepStrictEqual(yield* file.readAlloc(FileSystem.Size(4)), Option.none());

          yield* file.seek(FileSystem.Size(0), "start");
          yield* file.writeAll(new TextEncoder().encode("hey"));
          yield* file.truncate(FileSystem.Size(3));
          assert.strictEqual(yield* fs.readFileString("/file.txt"), "hey");
        }),
      ),
    );

    it.effect("streams and sinks file content", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/data.txt", "0123456789");
        const chunks = yield* fs.stream("/data.txt", { chunkSize: FileSystem.Size(4) }).pipe(
          Stream.map((chunk) => new TextDecoder().decode(chunk)),
          Stream.runCollect,
        );
        assert.deepStrictEqual(Array.from(chunks), ["0123", "4567", "89"]);

        yield* Stream.make(new TextEncoder().encode("ab"), new TextEncoder().encode("cd")).pipe(
          Stream.run(fs.sink("/out.txt")),
        );
        assert.strictEqual(yield* fs.readFileString("/out.txt"), "abcd");
      }),
    );

    it.effect("copies, renames, links and removes", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/a.txt", "hello");
        yield* fs.copyFile("/a.txt", "/b.txt");
        assert.strictEqual(yield* fs.readFileString("/b.txt"), "hello");

        yield* fs.rename("/b.txt", "/c.txt");
        assert.isFalse(yield* fs.exists("/b.txt"));
        assert.isTrue(yield* fs.exists("/c.txt"));

        yield* fs.link("/a.txt", "/d.txt");
        assert.strictEqual(yield* fs.readFileString("/d.txt"), "hello");

        yield* fs.remove("/a.txt");
        assert.isFalse(yield* fs.exists("/a.txt"));
        yield* fs.remove("/missing.txt", { force: true });

        yield* fs.makeDirectory("/dir/sub", { recursive: true });
        yield* fs.remove("/dir", { recursive: true });
        assert.isFalse(yield* fs.exists("/dir"));
      }),
    );

    it.effect("copies directories recursively", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory("/src/sub", { recursive: true });
        yield* fs.writeFileString("/src/a.txt", "a");
        yield* fs.writeFileString("/src/sub/b.txt", "b");
        yield* fs.copy("/src", "/dst");
        assert.strictEqual(yield* fs.readFileString("/dst/a.txt"), "a");
        assert.strictEqual(yield* fs.readFileString("/dst/sub/b.txt"), "b");
      }),
    );

    it.effect("globs for patterns", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/workspace/a.ts", "");
        yield* fs.writeFileString("/workspace/b.js", "");
        yield* fs.writeFileString("/workspace/src/c.ts", "");
        assert.deepStrictEqual(yield* fs.glob("**/*.ts", { root: "/workspace" }), [
          "a.ts",
          "src/c.ts",
        ]);
        assert.deepStrictEqual(
          yield* fs.glob("**/*.ts", { root: "/workspace", exclude: ["**/src/**"] }),
          ["a.ts"],
        );
      }),
    );

    it.effect("creates scoped temp directories and files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "agent-" });
        assert.isTrue(directory.startsWith("/tmp/agent-"));
        assert.isTrue(yield* fs.exists(directory));

        const file = yield* fs.makeTempFileScoped({ suffix: ".txt" });
        assert.isTrue(yield* fs.exists(file));
        assert.isTrue(file.endsWith(".txt"));
        assert.isTrue(yield* fs.exists("/tmp"));
      }),
    );

    it.effect("creates symbolic links and resolves real paths", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/target.txt", "hello");
        yield* fs.symlink("/target.txt", "/link.txt");
        assert.strictEqual(yield* fs.readLink("/link.txt"), "/target.txt");
        assert.strictEqual(yield* fs.realPath("/link.txt"), "/target.txt");
        const info = yield* fs.stat("/link.txt");
        assert.strictEqual(info.type, "File");
      }),
    );

    it.effect("truncates and updates timestamps", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/file.txt", "0123456789");
        yield* fs.truncate("/file.txt", FileSystem.Size(3));
        assert.strictEqual(yield* fs.readFileString("/file.txt"), "012");

        const atime = new Date(0);
        const mtime = new Date(1000);
        yield* fs.utimes("/file.txt", atime, mtime);
        const info = yield* fs.stat("/file.txt");
        assert.deepStrictEqual(info.atime, Option.some(atime));
        assert.deepStrictEqual(info.mtime, Option.some(mtime));
      }),
    );

    it.effect("changes permissions and ownership", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/file.txt", "hello");
        yield* fs.chmod("/file.txt", 0o600);
        yield* fs.chown("/file.txt", 0, 0);
        const info = yield* fs.stat("/file.txt");
        assert.strictEqual(info.mode & 0o777, 0o600);
      }),
    );

    it.effect(
      "watches directory changes",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory("/watched");
          yield* fs.writeFileString("/watched/a.txt", "hello");
          const fiber = yield* fs
            .watch("/watched")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
          yield* fs.writeFileString("/watched/a.txt", "updated");
          const [event] = yield* Fiber.join(fiber);
          assert.deepStrictEqual(event, { _tag: "Update", path: "/watched/a.txt" });
        }),
      10000,
    );
  });

  it.effect("builds an isolated volume per provide", () =>
    Effect.gen(function* () {
      const writeMarker = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString("/marker.txt", "x");
      });
      const readMarker = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.exists("/marker.txt");
      });
      yield* Effect.provide(writeMarker, Fs.layer);
      const second = yield* Effect.provide(readMarker, Fs.layer);
      // a second provide must build a fresh, empty volume
      assert.isFalse(second);
    }),
  );

  it.effect("exposes the underlying volume through MemFs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const memfs = yield* MemFs;
      yield* fs.writeFileString("/vol.txt", "hello");
      assert.deepStrictEqual(memfs.vol.toJSON(), { "/vol.txt": "hello" });
    }).pipe(Effect.provide(Fs.layer)),
  );

  it.effect("layerWith seeds the volume", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      assert.strictEqual(yield* fs.readFileString("/workspace/README.md"), "# hello");
      assert.isTrue(yield* fs.exists("/workspace/src/index.ts"));
    }).pipe(
      Effect.provide(
        Fs.layerWith({
          "/workspace": {
            "README.md": "# hello",
            src: { "index.ts": "" },
          },
        }),
      ),
    ),
  );
});
