import { Sandbox, Snapshot } from "@open-insight/core/internal";
import { Spawn } from "@open-insight/core/utils";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { make } from "../src/index.ts";

const AppleTestLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

const container = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* Spawn.Service;
    return yield* spawner
      .string(CP.make("container", args))
      .pipe(Effect.map((output) => output.trim()));
  });

const imageExists = (name: string) =>
  container(["image", "inspect", name]).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

const snapshot = Snapshot.make({
  image: "docker.io/library/alpine:3.21",
  instructions: [Snapshot.Inst.run("echo base > /snapshot-marker")],
});

describe("Apple container sandbox provider", () => {
  it.live(
    "builds uncached snapshots and removes them when the scope closes",
    () =>
      Effect.gen(function* () {
        const expectedHandle = yield* Snapshot.Handle.make(snapshot);
        yield* container(["image", "delete", "--force", expectedHandle.name]).pipe(Effect.ignore);
        const provider = yield* make({});
        const handle = yield* provider.aquireSnapshot({ snapshot, cache: false });

        assert.isTrue(yield* imageExists(handle.name));

        return handle.name;
      }).pipe(
        Effect.scoped,
        Effect.flatMap((name) =>
          Effect.gen(function* () {
            assert.isFalse(yield* imageExists(name));
          }),
        ),
        Effect.provide(AppleTestLayer),
      ),
    120_000,
  );

  it.live(
    "derives snapshots and runs sandboxes with exec and file operations",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* make({});
          const base = yield* provider.aquireSnapshot({ snapshot, cache: false });
          const derived = yield* provider.deriveSnapshot({
            handle: base,
            context: "/tmp",
            instructions: [Snapshot.Inst.run("echo derived > /derived-marker")],
            cache: false,
          });
          const sandbox = yield* provider.runSandbox({
            handle: derived,
            resources: Sandbox.Resources.make({
              numCPUs: 1,
              memoryMiB: 256,
              network: false,
            }),
          });

          assert.strictEqual(
            (yield* sandbox.cmd({ command: "cat", args: ["/snapshot-marker"] })).stdout.trim(),
            "base",
          );
          assert.strictEqual(
            (yield* sandbox.cmd({ command: "cat", args: ["/derived-marker"] })).stdout.trim(),
            "derived",
          );
          assert.strictEqual(
            (yield* sandbox.cmd({ command: "pwd", cwd: "/tmp" })).stdout.trim(),
            "/tmp",
          );
          assert.strictEqual(
            (yield* sandbox.cmd({
              command: "printenv",
              args: ["TEST_VALUE"],
              env: { TEST_VALUE: "from-env" },
            })).stdout.trim(),
            "from-env",
          );

          yield* sandbox.writeFile({ sandboxPath: "/tmp/message.txt", content: "hello apple\n" });
          assert.strictEqual(
            yield* sandbox.readFile({ sandboxPath: "/tmp/message.txt" }),
            "hello apple\n",
          );

          const fs = yield* FileSystem.FileSystem;
          const hostFile = yield* fs.makeTempFileScoped({
            prefix: "open-insight-apple-download-",
          });
          yield* sandbox.download({ sandboxPath: "/tmp/message.txt", hostPath: hostFile });
          assert.strictEqual(yield* fs.readFileString(hostFile), "hello apple\n");

          const uploadFile = yield* fs.makeTempFileScoped({
            prefix: "open-insight-apple-upload-",
          });
          yield* fs.writeFileString(uploadFile, "uploaded\n");
          yield* sandbox.upload({ hostPath: uploadFile, sandboxPath: "/tmp/uploaded.txt" });
          assert.strictEqual(
            yield* sandbox.readFile({ sandboxPath: "/tmp/uploaded.txt" }),
            "uploaded\n",
          );

          const expose = yield* sandbox
            .expose({ sandboxPort: 8080, hostPort: 18080 })
            .pipe(Effect.exit);
          assert.isTrue(expose._tag === "Failure");
        }),
      ).pipe(Effect.provide(AppleTestLayer)),
    120_000,
  );

  it.live(
    "exposes configured ports with fixed host ports",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* make({ portMappings: [{ sandboxPort: 8080, hostPort: 18080 }] });
          const handle = yield* provider.aquireSnapshot({ snapshot, cache: true });
          const insufficientMemory = yield* provider
            .runSandbox({
              handle,
              resources: Sandbox.Resources.make({ memoryMiB: 128 }),
            })
            .pipe(Effect.exit);
          assert.isTrue(insufficientMemory._tag === "Failure");
          const sandbox = yield* provider.runSandbox({
            handle,
            resources: Sandbox.Resources.make({
              numCPUs: 1,
              memoryMiB: 256,
              network: true,
            }),
          });

          const first = yield* sandbox.expose({ sandboxPort: 8080 });
          const second = yield* sandbox.expose({ sandboxPort: 8080, hostPort: 18080 });

          assert.strictEqual(first.hostUrl, "http://localhost:18080");
          assert.strictEqual(second.hostUrl, first.hostUrl);

          const mismatchedHostPort = yield* sandbox
            .expose({ sandboxPort: 8080, hostPort: 18081 })
            .pipe(Effect.exit);
          assert.isTrue(mismatchedHostPort._tag === "Failure");
        }),
      ).pipe(Effect.provide(AppleTestLayer)),
    120_000,
  );
});
