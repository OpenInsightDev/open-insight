import { Benchmark, Metric, Snapshot, Task } from "#/export.ts";
import { Effect, FileSystem, Logger, pipe, References } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { Agent, Exec, Harness, Sandbox } from "@open-insight/eval";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { LanguageModel, Prompt } from "effect/unstable/ai";
import { NodeHttpClient } from "@effect/platform-node";
import * as fs from "fs/promises";
import * as path from "node:path";
import { assert, it } from "@effect/vitest";

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";
const debugLogPath = path.join(import.meta.dirname, ".logs", "verilog-eval.debug.log");

const hasNoMismatches = (output: string): boolean =>
  /Mismatches:\s*0\s+in\s+\d+\s+samples/.test(output);

class VETask extends Task.Task<{ simPass: boolean }, { category: string }> {}

async function* loadTasks(repoPath: string): AsyncIterable<VETask> {
  const datasetDir = path.join(repoPath, datasetDirName);
  const files = await fs.readdir(datasetDir);
  const promptFiles = files.filter((file) => file.endsWith(promptSuffix));

  const snapshot = Snapshot.parseContainerfile(
    `FROM ubuntu:latest
     RUN apt-get update && apt-get install -y iverilog && rm -rf /var/lib/apt/lists/*`,
  );

  for (const promptFile of promptFiles) {
    const name = promptFile.slice(0, -promptSuffix.length);
    const prompt = await fs.readFile(path.join(datasetDir, promptFile), "utf8");
    const refPath = path.join(datasetDir, `${name}_ref.sv`);
    const testPath = path.join(datasetDir, `${name}_test.sv`);

    yield new VETask({
      name,
      prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: prompt })] })],
      grader: async ({ upload, $ }) => {
        await $`mkdir -p /tmp/verilog-eval`;
        await upload({
          hostPath: refPath,
          sandboxPath: "/tmp/verilog-eval/ref.sv",
        });
        await upload({
          hostPath: testPath,
          sandboxPath: "/tmp/verilog-eval/test.sv",
        });

        const output =
          await $`cp top.v /tmp/verilog-eval/top.v && cd /tmp/verilog-eval && iverilog -g2012 -s tb -o simv top.v ref.sv test.sv && vvp simv`;
        return { simPass: hasNoMismatches(output) };
      },
      verifier: {
        exec: async ({ upload, $ }) => {
          await upload({
            hostPath: refPath,
            sandboxPath: "/tmp/ref.v",
          });
          await $`sed 's/RefModule/TopModule/g' /tmp/ref.v > top.v`;
          return Prompt.empty;
        },
        expect: { simPass: true },
      },
      snapshot,
      extra: { category: "verilog-eval" },
    });
  }
}

const runBenchmark = Effect.fn("runBenchmark")(function* () {
  const repoPath = path.resolve("./.repos/verilog-eval");
  const tasks = yield* Task.Load.fromAsyncIter(loadTasks(repoPath)).pipe(Task.Load.select(4));

  const benchmark = yield* Benchmark.make({
    name: "verilog-eval",
    tasks,
  });

  const metrics = Metric.init<VETask>().pipe(
    Metric.withTask("passAt1", (grades) =>
      pipe(
        grades.map(({ simPass }) => simPass),
        Metric.passAtK(1),
      ),
    ),
    Metric.withTask("passAt3", (grades) =>
      pipe(
        grades.map(({ simPass }) => simPass),
        Metric.passAtK(3),
      ),
    ),
    Metric.withBenchmark("avgPassAt1", (tasks) =>
      pipe(
        Object.values(tasks).map(({ passAt1 }) => passAt1),
        Metric.mean,
      ),
    ),
    Metric.withBenchmark("avgPassAt3", (tasks) =>
      pipe(
        Object.values(tasks).map(({ passAt3 }) => passAt3),
        Metric.mean,
      ),
    ),
  );

  const client = yield* OpenAiClient.make({}).pipe(Effect.provide(NodeHttpClient.layerUndici));

  const model = yield* OpenAiLanguageModel.make({
    model: "deepseek-v4-flash",
  }).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));

  const agent = yield* Agent.Effect.make({}).pipe(
    Effect.provideService(LanguageModel.LanguageModel, model),
  );

  const sandbox = yield* Sandbox.Docker.make({});

  const harness = yield* Harness.make({
    name: "verilog-eval",
  }).pipe(
    Effect.provideService(Agent.ProviderService, agent),
    Effect.provideService(Sandbox.ProviderService, sandbox),
  );

  const harnessMetrics = yield* metrics;

  const exec = yield* Exec.make<VETask>({
    benchmark,
    harness,
    metrics: harnessMetrics,
    trailCount: 3,
  });

  const result = yield* Exec.run(exec, {
    verifMode: true,
    trailConcurrency: 16,
  });
  return result;
});

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(path.dirname(debugLogPath), { recursive: true });

  const fileLogger = yield* Logger.formatLogFmt.pipe(Logger.toFile(debugLogPath));

  return yield* Effect.gen(function* () {
    yield* Effect.logInfo(`[verilog-eval] writing debug logs to ${debugLogPath}`);
    const result = yield* runBenchmark();
    yield* Effect.logInfo("[verilog-eval] benchmark result", JSON.stringify(result));
    return result;
  }).pipe(
    Effect.onError((cause) => Effect.logError("[verilog-eval] benchmark failed", cause)),
    Effect.provide(Logger.layer([fileLogger], { mergeWithExisting: true })),
    Effect.provideService(References.MinimumLogLevel, "Debug"),
  );
})
  .pipe(Effect.scoped)
  .pipe(Effect.provide(DevTools.layer()));

it("verilog-eval benchmark should pass", async () => {
  const result = await Exec.runPromise(main);
  assert.isTrue(result !== null);
}, 100000);
