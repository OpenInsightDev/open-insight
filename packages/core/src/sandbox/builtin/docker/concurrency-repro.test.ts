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
  Spawn.SpawnService.layer.pipe(Layer.provide(NodeServices.layer)),
);

const snapshot = Snapshot.make({
  image: "busybox:latest",
});

const verilogSnapshot = Snapshot.parseContainerfile(
  `FROM alpine:latest
RUN apk add --no-cache iverilog`,
);

describe("Docker sandbox provider concurrency repro", () => {
  layer(DockerTestLayer)((it) => {
    it.effect("runs many sandboxes and commands without hanging", () =>
      Effect.gen(function* () {
        const provider = yield* make({});
        const handle = yield* provider.aquireSnapshot({ snapshot, cache: true });

        const results = yield* Effect.all(
          Array.from({ length: 32 }, (_, index) =>
            Effect.gen(function* () {
              const sandbox = yield* provider.runSandbox({
                handle,
                resources: Sandbox.Resources.make({
                  numCPUs: 1,
                  memoryMiB: 128,
                  network: false,
                }),
              });

              const result = yield* sandbox.cmd(CP.make`sh -c ${`printf sandbox-${index}`}`);
              return result;
            }).pipe(Effect.timeout("5 seconds")),
          ),
          { concurrency: "unbounded" },
        );

        assert.strictEqual(results.length, 32);
        for (const [index, result] of results.entries()) {
          assert.strictEqual(result.exitCode, 0);
          assert.strictEqual(result.stdout, `sandbox-${index}`);
        }
      }).pipe(Effect.scoped, Effect.timeout("25 seconds")),
      30_000,
    );

    it.effect(
      "runs many promise-bridge upload and shell verifier commands",
      () =>
        Effect.gen(function* () {
          const provider = yield* make({});
          const fs = yield* FileSystem.FileSystem;
          const handle = yield* provider.aquireSnapshot({ snapshot, cache: true });
          const refPath = yield* fs.makeTempFileScoped({
            prefix: "open-insight-verifier-ref-",
            suffix: ".sv",
          });
          yield* fs.writeFileString(refPath, "module RefModule; endmodule\n");

          const results = yield* Effect.all(
            Array.from({ length: 128 }, () =>
              Effect.gen(function* () {
                const sandbox = yield* provider.runSandbox({
                  handle,
                  resources: Sandbox.Resources.make({
                    numCPUs: 1,
                    memoryMiB: 128,
                    network: false,
                  }),
                });
                const promiseSandbox = yield* Sandbox.asPromise(sandbox);

                return yield* Effect.tryPromise(async () => {
                  await promiseSandbox.upload({
                    hostPath: refPath,
                    sandboxPath: "/tmp/ref.v",
                  });
                  return await promiseSandbox.$`sed 's/RefModule/TopModule/g' /tmp/ref.v > top.v && cat top.v`;
                }).pipe(Effect.timeout("10 seconds"));
              }),
            ),
            { concurrency: 16 },
          );

          assert.strictEqual(results.length, 128);
          for (const result of results) {
            assert.strictEqual(result, "module TopModule; endmodule\n");
          }
        }).pipe(Effect.scoped, Effect.timeout("60 seconds")),
      70_000,
    );

    it.effect(
      "runs many verilog grader commands through promise bridge",
      () =>
        Effect.gen(function* () {
          const provider = yield* make({});
          const fs = yield* FileSystem.FileSystem;
          const handle = yield* provider.aquireSnapshot({ snapshot: verilogSnapshot, cache: true });
          const topPath = yield* fs.makeTempFileScoped({
            prefix: "open-insight-top-",
            suffix: ".v",
          });
          const refPath = yield* fs.makeTempFileScoped({
            prefix: "open-insight-ref-",
            suffix: ".sv",
          });
          const testPath = yield* fs.makeTempFileScoped({
            prefix: "open-insight-test-",
            suffix: ".sv",
          });
          yield* fs.writeFileString(
            topPath,
            "module TopModule(input a, output y); assign y = a; endmodule\n",
          );
          yield* fs.writeFileString(
            refPath,
            "module RefModule(input a, output y); assign y = a; endmodule\n",
          );
          yield* fs.writeFileString(
            testPath,
            [
              "module tb;",
              "  reg a;",
              "  wire y;",
              "  TopModule dut(.a(a), .y(y));",
              "  initial begin",
              "    a = 0; #1; if (y !== 0) begin $display(\"Mismatches: 1 in 2 samples\"); $finish; end",
              "    a = 1; #1; if (y !== 1) begin $display(\"Mismatches: 1 in 2 samples\"); $finish; end",
              "    $display(\"Mismatches: 0 in 2 samples\");",
              "    $finish;",
              "  end",
              "endmodule",
              "",
            ].join("\n"),
          );

          const outputs = yield* Effect.all(
            Array.from({ length: 200 }, () =>
              Effect.gen(function* () {
                const sandbox = yield* provider.runSandbox({
                  handle,
                  resources: Sandbox.Resources.make({
                    numCPUs: 1,
                    memoryMiB: 128,
                    network: false,
                  }),
                });
                const promiseSandbox = yield* Sandbox.asPromise(sandbox);

                return yield* Effect.tryPromise(async () => {
                  await promiseSandbox.$`mkdir -p /tmp/verilog-eval`;
                  await promiseSandbox.upload({
                    hostPath: topPath,
                    sandboxPath: "/tmp/verilog-eval/top.v",
                  });
                  await promiseSandbox.upload({
                    hostPath: refPath,
                    sandboxPath: "/tmp/verilog-eval/ref.sv",
                  });
                  await promiseSandbox.upload({
                    hostPath: testPath,
                    sandboxPath: "/tmp/verilog-eval/test.sv",
                  });
                  return await promiseSandbox.$`cd /tmp/verilog-eval && iverilog -g2012 -s tb -o simv top.v ref.sv test.sv && vvp simv`;
                }).pipe(Effect.timeout("15 seconds"));
              }),
            ),
            { concurrency: 16 },
          );

          assert.strictEqual(outputs.length, 200);
          for (const output of outputs) {
            assert.match(output, /Mismatches:\s*0\s+in\s+2\s+samples/);
          }
        }).pipe(Effect.scoped, Effect.timeout("180 seconds")),
      190_000,
    );

    it.effect(
      "does not hang when awaiting children after promise bridge commands",
      () =>
        Effect.gen(function* () {
          const provider = yield* make({});
          const fs = yield* FileSystem.FileSystem;
          const handle = yield* provider.aquireSnapshot({ snapshot, cache: true });
          const refPath = yield* fs.makeTempFileScoped({
            prefix: "open-insight-await-ref-",
            suffix: ".sv",
          });
          yield* fs.writeFileString(refPath, "module RefModule; endmodule\n");

          yield* Effect.all(
            Array.from({ length: 32 }, () =>
              Effect.gen(function* () {
                const sandbox = yield* provider.runSandbox({
                  handle,
                  resources: Sandbox.Resources.make({
                    numCPUs: 1,
                    memoryMiB: 128,
                    network: false,
                  }),
                });
                const promiseSandbox = yield* Sandbox.asPromise(sandbox);
                yield* Effect.tryPromise(async () => {
                  await promiseSandbox.upload({
                    hostPath: refPath,
                    sandboxPath: "/tmp/ref.v",
                  });
                  await promiseSandbox.$`sed 's/RefModule/TopModule/g' /tmp/ref.v > top.v`;
                });
              }),
            ),
            { concurrency: 16 },
          );
        }).pipe(Effect.scoped, Effect.awaitAllChildren, Effect.timeout("30 seconds")),
      40_000,
    );
  });
});
