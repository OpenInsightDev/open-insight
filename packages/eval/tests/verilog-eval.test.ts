import { Benchmark, Sandbox, Task } from "@open-insight/eval";
import path from "pathe";
import * as fs from "fs";

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
