import { Agent, Benchmark, Harness, Sandbox, Task, Effect, Exec } from "@open-insight/eval";
import path from "pathe";
import * as fs from "fs";
import { Chat } from "effect/unstable/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Config } from "effect";
import { NodeServices } from "@effect/platform-node";

type VerilogEvalTask = Task.Task<Task.Grader<"simPass", boolean>>;

const tasks = Task.withGitRepo("https://github.com/NVlabs/verilog-eval.git")((repoPath) => {
  const datasetPath = path.join(repoPath, "dataset_spec-to-rtl");
  return Task.fromIterable<VerilogEvalTask>(
    fs
      .readdirSync(datasetPath)
      .filter((file) => file.endsWith("_prompt.txt"))
      .map((file) => {
        const match = file.match(/^Prob\d+_(.+)_prompt\.txt$/);
        if (!match) throw new Error(`Unexpected filename format: ${file}`);
        const name = match[1];
        const promptContent = fs.readFileSync(path.join(datasetPath, file), "utf-8");

        return Task.init<VerilogEvalTask>({
          name,
          description: promptContent,
        }).pipe(
          Task.withTextPrompt(`${promptContent}.\n\n Write your answer into a file named top.sv.`),
          Task.withGrader("simPass", async ({ $, upload }) => {
            await upload({
              hostPath: path.join(datasetPath, `${name}_ref.sv`),
              sandboxPath: `/workspace/ref.sv`,
            });
            await upload({
              hostPath: path.join(datasetPath, `${name}_test.sv`),
              sandboxPath: `/workspace/test.sv`,
            });
            await $({
              command: "iverilog",
              args: [`test.sv`, "top.sv", "ref.sv"],
            });

            try {
              await $({ command: "vvp", args: [`a.out`] });
              return true;
            } catch {
              return false;
            }
          }),
          Task.withSnapshot(
            Sandbox.Snapshot.fromContainerfile(`
              FROM docker.io/library/alpine:latest
              RUN apk add --no-cache iverilog
              WORKDIR /workspace
            `),
          ),
          Task.withContext(Sandbox.Context.makeDir(datasetPath)),
          Task.build,
        );
      }),
  );
});

const benchmark = Benchmark.init<VerilogEvalTask>({
  name: "Verilog Eval Benchmark",
  description: "A benchmark for testing the Verilog Eval Task",
}).pipe(Benchmark.withTasks(tasks), Benchmark.build);

const OpenAi = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
});
const GPT = OpenAiLanguageModel.model("gpt-5.4");
const agent = Agent.Effect.make({ chat: Chat.empty }).pipe(
  Effect.provide(GPT),
  Effect.provide(OpenAi),
);

const sandbox = Sandbox.Docker.make({
  portMappings: [{ sandboxPort: 80, hostPort: 8080 }],
});

const harness = Harness.init<VerilogEvalTask>().pipe(
  Harness.withSandboxProvider(sandbox),
  Harness.withAgentProvider(agent),
  Harness.build,
);

const executor = Exec.init<VerilogEvalTask>().pipe(
  Exec.withBenchmark(benchmark),
  Exec.withHarness(harness),
  Exec.build,
  Effect.provide(NodeServices.layer),
);

const result = await Effect.runPromise(
  Exec.run(executor, {
    sandboxConfig: { cacheSnapshot: false },
  }),
);

console.log(result);
