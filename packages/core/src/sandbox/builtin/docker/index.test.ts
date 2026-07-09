import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Sandbox from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Spawn } from "#/utils/index.ts";
import { make } from "./index.ts";

const DockerTestLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

const docker = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* Spawn.Service;
    return yield* spawner
      .string(CP.make("docker", args))
      .pipe(Effect.map((output) => output.trim()));
  });

const imageExists = (name: string) =>
  docker(["image", "inspect", name]).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

const snapshot = Snapshot.make({
  image: "busybox:latest",
  instructions: [Snapshot.Inst.run("echo base > /snapshot-marker")],
});

describe("Docker sandbox provider", () => {
  layer(DockerTestLayer)((it) => {
    it.effect("builds uncached snapshots and removes them when the scope closes", () =>
      Effect.gen(function* () {
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
      ),
    );

    it.effect("derives snapshots and runs sandboxes with exec and file operations", () =>
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
              memoryMiB: 128,
              network: false,
            }),
          });

          assert.strictEqual(
            (yield* sandbox.cmd(CP.make`cat /snapshot-marker`)).stdout?.trim(),
            "base",
          );
          assert.strictEqual(
            (yield* sandbox.cmd(CP.make`cat /derived-marker`)).stdout?.trim(),
            "derived",
          );
          assert.strictEqual(
            (yield* sandbox.cmd(CP.make({ cwd: "/tmp" })`pwd`)).stdout?.trim(),
            "/tmp",
          );
          assert.strictEqual(
            (yield* sandbox.cmd(
              CP.make({ env: { TEST_VALUE: "from-env" } })`printenv TEST_VALUE`,
            )).stdout?.trim(),
            "from-env",
          );

          yield* sandbox.writeFile({ sandboxPath: "/tmp/message.txt", content: "hello docker\n" });
          assert.strictEqual(
            yield* sandbox.readFile({ sandboxPath: "/tmp/message.txt" }),
            "hello docker\n",
          );

          const fs = yield* FileSystem.FileSystem;
          const hostFile = yield* fs.makeTempFileScoped({
            prefix: "open-insight-docker-download-",
          });
          yield* sandbox.download({ sandboxPath: "/tmp/message.txt", hostPath: hostFile });
          assert.strictEqual(yield* fs.readFileString(hostFile), "hello docker\n");

          const uploadFile = yield* fs.makeTempFileScoped({
            prefix: "open-insight-docker-upload-",
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
      ),
    );

    it.effect("exposes configured ports with docker-assigned host ports", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* make({ portMappings: [{ sandboxPort: 8080 }] });
          const handle = yield* provider.aquireSnapshot({ snapshot, cache: true });
          const sandbox = yield* provider.runSandbox({
            handle,
            resources: Sandbox.Resources.make({
              numCPUs: 1,
              memoryMiB: 128,
              network: true,
            }),
          });

          const first = yield* sandbox.expose({ sandboxPort: 8080 });
          const second = yield* sandbox.expose({ sandboxPort: 8080 });

          assert.match(first.hostUrl, /^http:\/\/localhost:\d+$/);
          assert.strictEqual(second.hostUrl, first.hostUrl);
          assert.notStrictEqual(first.hostUrl, "http://localhost:8080");

          const fixedHostPortExpose = yield* sandbox
            .expose({ sandboxPort: 8080, hostPort: 8080 })
            .pipe(Effect.exit);
          assert.isTrue(fixedHostPortExpose._tag === "Failure");
        }),
      ),
    );
  });
});
