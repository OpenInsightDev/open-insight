import { Benchmark, Metric, Snapshot, Task } from "#/export.ts";
import { Config, Effect, pipe } from "effect";
import { Agent, Exec, Harness, Sandbox } from "@open-insight/eval";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { LanguageModel, Prompt } from "effect/unstable/ai";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import * as fs from "fs/promises";
import * as path from "node:path";

class VETask extends Task.Task<{ simPass: boolean }, { category: string }> {}

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";

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
            sandboxPath: "/tmp/ref.v",
          });
          await $`sed 's/RefModule/TopModule/g' /tmp/ref.v > top.v`;
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
  const tasks = yield* Task.withGithub<VETask>("NVlabs/verilog-eval", {
    commit: "c498220d0a52248f8e3fdffe279075215bde2da6",
  })((repoPath) => Task.Load.fromAsyncIter(loadTasks(repoPath)));

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
  );

  const client = yield* OpenAiClient.make({
    apiKey: yield* Config.redacted("OPENAI_API_KEY"),
    apiUrl: yield* Config.string("OPENAI_BASE_URL"),
  }).pipe(Effect.provide(NodeHttpClient.layerUndici));

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
    trailCount: 6,
  });

  const result = yield* Exec.run(exec, {
    verifMode: true,
    trailConcurrency: 16,
  });
  return result;
}).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

try {
  const result = await main.pipe(Effect.runPromise);
  console.log("Benchmark result:", result);
} catch (error) {
  console.error("Error running benchmark:", error);
}
