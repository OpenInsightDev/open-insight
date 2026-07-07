import { Benchmark, Metric, Task } from "@/export.ts";
import { Config, Effect, pipe } from "effect";
import { Agent, Exec, Harness, Sandbox } from "@open-insight/eval";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { LanguageModel } from "effect/unstable/ai";
import { NodeHttpClient } from "@effect/platform-node";

class VETask extends Task.Task<{ simPass: boolean }, { category: string }> {}

const main = Effect.gen(function* () {
  const tasks = yield* Task.withGithub<VETask>("NVlabs/verilog-eval", {
    commit: "c498220d0a52248f8e3fdffe279075215bde2da6",
  })(async (repoPath) => {
    throw new Error(`Failed to load tasks from ${repoPath}`);
  });

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
  });

  const result = yield* Exec.run(exec);
  return result;
});

try {
  const result = await main.pipe(Effect.runPromise);
  console.log("Benchmark result:", result);
} catch (error) {
  console.error("Error running benchmark:", error);
}
