import { Benchmark, Metric, Snapshot, Task } from "#/export.ts";
import { Config, Effect, Logger, References, pipe } from "effect";
import { Agent, Exec, Harness, Sandbox } from "@open-insight/eval";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { LanguageModel, Prompt } from "effect/unstable/ai";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import * as fs from "fs/promises";
import * as path from "node:path";

class VETask extends Task.Task<{ simPass: boolean }, { category: string }> {}

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";
const debugLogPath = path.resolve("verilog-eval.debug.log");

const hasNoMismatches = (output: string): boolean =>
  /Mismatches:\s*0\s+in\s+\d+\s+samples/.test(output);

async function* loadTasks(repoPath: string): AsyncIterable<VETask> {
  console.error(`[verilog-eval] loadTasks: reading ${repoPath}`);
  const datasetDir = path.join(repoPath, datasetDirName);
  const files = await fs.readdir(datasetDir);
  const promptFiles = files.filter((file) => file.endsWith(promptSuffix)).sort();
  console.error(`[verilog-eval] loadTasks: found ${promptFiles.length} prompt files`);

  const snapshot = Snapshot.parseContainerfile(
    `FROM alpine:latest
    RUN apk add --no-cache iverilog`,
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
            sandboxPath: "ref.v",
          });
          await $`sed 's/RefModule/TopModule/g' ref.v > top.v`;
          return Prompt.empty;
        },
        expected: { simPass: true },
      },
      snapshot,
      extra: { category: datasetDirName },
    });
  }
}

const main = Effect.gen(function* () {
  const fileLogger = yield* Logger.formatJson.pipe(
    Logger.toFile(debugLogPath, {
      flag: "w",
    }),
  );

  const program = Effect.gen(function* () {
    yield* Effect.logDebug("verilog-eval: starting benchmark script", { debugLogPath });

    yield* Effect.logDebug("verilog-eval: loading tasks from GitHub");
  const tasks = yield* Task.withGithub<VETask>("NVlabs/verilog-eval", {
    commit: "c498220d0a52248f8e3fdffe279075215bde2da6",
  })((repoPath) => Task.Load.fromAsyncIter(loadTasks(repoPath)));
    yield* Effect.logDebug("verilog-eval: loaded task effects", { taskCount: tasks.length });

    yield* Effect.logDebug("verilog-eval: creating benchmark");
  const benchmark = yield* Benchmark.make({
    name: "verilog-eval",
    tasks,
  });
    yield* Effect.logDebug("verilog-eval: created benchmark", { taskCount: benchmark.tasks.length });

    yield* Effect.logDebug("verilog-eval: initializing metrics");
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
  );
    yield* Effect.logDebug("verilog-eval: initialized metrics");

    yield* Effect.logDebug("verilog-eval: creating OpenAI client");
  const client = yield* OpenAiClient.make({
    apiKey: yield* Config.redacted("OPENAI_API_KEY"),
    apiUrl: yield* Config.string("OPENAI_BASE_URL"),
  }).pipe(Effect.provide(NodeHttpClient.layerUndici));
    yield* Effect.logDebug("verilog-eval: created OpenAI client");

    yield* Effect.logDebug("verilog-eval: creating language model");
  const model = yield* OpenAiLanguageModel.make({
    model: "deepseek-v4-flash",
  }).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));
    yield* Effect.logDebug("verilog-eval: created language model");

    yield* Effect.logDebug("verilog-eval: creating agent");
  const agent = yield* Agent.Effect.make({}).pipe(
    Effect.provideService(LanguageModel.LanguageModel, model),
  );
    yield* Effect.logDebug("verilog-eval: created agent");

    yield* Effect.logDebug("verilog-eval: creating Docker sandbox");
  const sandbox = yield* Sandbox.Docker.make({});
    yield* Effect.logDebug("verilog-eval: created Docker sandbox");

    yield* Effect.logDebug("verilog-eval: creating harness");
  const harness = yield* Harness.make({
    name: "verilog-eval",
  }).pipe(
    Effect.provideService(Agent.ProviderService, agent),
    Effect.provideService(Sandbox.ProviderService, sandbox),
  );
    yield* Effect.logDebug("verilog-eval: created harness");

    yield* Effect.logDebug("verilog-eval: materializing metrics");
  const harnessMetrics = yield* metrics;
    yield* Effect.logDebug("verilog-eval: materialized metrics");

    yield* Effect.logDebug("verilog-eval: creating executor");
  const exec = yield* Exec.make<VETask>({
    benchmark,
    harness,
    metrics: harnessMetrics,
    trailCount: 6,
  });
    yield* Effect.logDebug("verilog-eval: created executor");

    yield* Effect.logDebug("verilog-eval: running executor");
  const result = yield* Exec.run(exec, {
    verifMode: true,
    trailConcurrency: 16,
  });
    yield* Effect.logDebug("verilog-eval: executor completed");
    return result;
  });

  return yield* program.pipe(
    Effect.provide(Logger.layer([fileLogger], { mergeWithExisting: true })),
    Effect.provideService(References.MinimumLogLevel, "Debug"),
  );
}).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

try {
  const result = await main.pipe(Effect.runPromise);
  console.log("Benchmark result:", result);
} catch (error) {
  console.error("Error running benchmark:", error);
}
