import {
  Bench,
  BenchMetric,
  Chart,
  Eval,
  Grade,
  Harness,
  Sandbox,
  Snapshot,
  Task,
  TaskMetric,
  Tasks,
} from "@open-insight/eval";
import { makeOpenAiCompat } from "@open-insight/agent";
import { Config, Effect, Schema } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";
const deliveryInstructions = [
  "Complete the task by writing the full Verilog solution to /workspace/top.v.",
  "The grader reads only /workspace/top.v; code in chat or any other path is not submitted.",
  "Use SandboxWriteFile with sandboxPath /workspace/top.v and include the complete TopModule.",
  "Before finishing, use SandboxReadFile on /workspace/top.v to confirm the submitted artifact.",
].join("\n");

const current = import.meta.dirname!;
const envPath = path.resolve(current, "../../../.env");

const trailCount = 2;

const snapshot = Snapshot.make({
  image: "ubuntu:24.04",
  context: path.resolve(current),
  instructions: [
    Snapshot.run(
      `DEBIAN_FRONTEND=noninteractive apt-get update && \\
       apt-get install -y --no-install-recommends \\
            iverilog && \\
       rm -rf /var/lib/apt/lists/*`,
    ),
    Snapshot.workdir(`/workspace`),
  ],
});

async function* loadTasks(repoPath: string) {
  const datasetDir = path.resolve(repoPath, datasetDirName);

  for await (const dir of await fs.opendir(datasetDir)) {
    if (!dir.isFile() || !dir.name.endsWith(promptSuffix)) {
      continue;
    }

    const promptFile = dir.name;
    const id = promptFile.slice(0, -promptSuffix.length);
    const prompt = await fs.readFile(path.resolve(datasetDir, promptFile), "utf8");

    const refPath = path.resolve(datasetDir, `${id}_ref.sv`);
    const testPath = path.resolve(datasetDir, `${id}_test.sv`);

    yield* Task.make({
      id,
      name: id,
      snapshot,
    }).pipe(
      Task.stage("solve", {
        prompt: `${prompt.trimEnd()}\n\n${deliveryInstructions}`,
        grader: Grade.make(
          Schema.Struct({
            simPass: Schema.Boolean,
            diagnostic: Schema.optionalKey(
              Schema.Struct({
                artifactPresent: Schema.Boolean,
                topV: Schema.NullOr(Schema.String),
                simulatorOutput: Schema.String,
              }),
            ),
          }),
        )(
          async ({ upload, $ }) => {
            await $`mkdir -p /tmp/verilog-eval`;
            await upload({
              hostPath: refPath,
              sandboxPath: "/tmp/verilog-eval/ref.sv",
            });
            await upload({
              hostPath: testPath,
              sandboxPath: "/tmp/verilog-eval/test.sv",
            });
            if (id === "Prob099_m2014_q6c") {
              // VerilogEval issue #13: this testbench names Y1/Y3 as Y2/Y4.
              await $`sed -i -e 's/\.Y2(/.Y1(/g' -e 's/\.Y4(/.Y3(/g' /tmp/verilog-eval/test.sv`;
            }

            const hasNoMismatches = (output: string): boolean =>
              /Mismatches:\s*0\s+in\s+\d+\s+samples/.test(output);

            const artifactPresent =
              (await $`if [ -f top.v ]; then printf present; else printf missing; fi`).trim() ===
              "present";
            const topV = artifactPresent ? await $`cat top.v` : null;
            const output = await $`if \\
                  cp top.v /tmp/verilog-eval/top.v && \\
                  cd /tmp/verilog-eval && \\
                  iverilog -g2012 -s tb -o simv top.v ref.sv test.sv; \\
                then \\
                  vvp simv || true; \\
                fi 2>&1`;
            const simPass = hasNoMismatches(output);
            const diagnostic = { artifactPresent, topV, simulatorOutput: output };

            return { simPass, ...(simPass ? {} : { diagnostic }) };
          },
          {
            verif: async ({ upload, $ }) => {
              await upload({ hostPath: refPath, sandboxPath: "/tmp/ref.sv" });
              await $`sed 's/RefModule/TopModule/g' /tmp/ref.sv > top.v`;
              return null;
            },
            expect: { simPass: true },
          },
        ),
      }),
      Task.mapMetric(({ simPass }) => ({ pass: simPass }), TaskMetric.passAtK(1), {
        name: "Pass@1",
        description: "Estimated probability that one generated RTL solution passes simulation.",
        chart: (result) => [
          Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
          Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
        ],
      }),
      Task.mapMetric(({ simPass }) => ({ pass: simPass }), TaskMetric.passAtK(trailCount), {
        name: `Pass@${trailCount}`,
        description: `Estimated probability that at least one of ${trailCount} solutions passes.`,
        chart: (result) => [
          Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
          Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
        ],
      }),
      Task.mapMetric(({ simPass }) => ({ pass: simPass }), TaskMetric.passPowK(trailCount), {
        name: `Pass power ${trailCount}`,
        description: `Estimated probability that all ${trailCount} solutions pass.`,
        chart: (result) => [
          Chart.Pie.make({ legend: "All pass", value: result["pass^k"] }),
          Chart.Pie.make({ legend: "Not all pass", value: 1 - result["pass^k"] }),
        ],
      }),
      Task.trajMetric(TrajMetric.toolCallCount(), {
        name: "Tool call count",
        description: "Cumulative number of tool calls made while solving the task.",
        chart: ({ count }) => [Chart.Bar.make({ legend: "Tool calls", x: "Completed", y: count })],
        when: When.traj(When.toolCall()),
      }),
      Task.trajMetric(TrajMetric.toolCallSuccessRate(), {
        name: "Tool call success rate",
        description: "Share of completed tool calls that succeeded.",
        chart: ({ rate }) => [
          Chart.Pie.make({ legend: "Succeeded", value: rate }),
          Chart.Pie.make({ legend: "Failed", value: 1 - rate }),
        ],
        when: When.traj(When.toolCall()),
      }),
    );
  }
}

export const makeBench = Effect.fn(function* () {
  const tasks = yield* Tasks.withGithub("NVlabs/verilog-eval", {
    branch: "main",
    commit: "c498220d0a52248f8e3fdffe279075215bde2da6",
  })((repoPath) => Tasks.fromAsyncIter(loadTasks(repoPath)));

  return yield* Bench.make({
    id: "verilog-eval",
    tasks,
  }).pipe(
    Bench.mapMetric(({ simPass }) => ({ pass: simPass }), BenchMetric.avgPassAtK(1), {
      name: "Average pass at 1",
      description: "Mean pass@1 estimate across evaluated tasks.",
      chart: (result) => [
        Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
        Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
      ],
    }),
    Bench.mapMetric(({ simPass }) => ({ pass: simPass }), BenchMetric.avgPassAtK(trailCount), {
      name: `Average pass at ${trailCount}`,
      description: `Mean pass@${trailCount} estimate across evaluated tasks.`,
      chart: (result) => [
        Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
        Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
      ],
    }),
    Bench.mapMetric(({ simPass }) => ({ pass: simPass }), BenchMetric.avgPassPowK(trailCount), {
      name: `Average pass power ${trailCount}`,
      description: `Mean pass^${trailCount} estimate across evaluated tasks.`,
      chart: (result) => [
        Chart.Pie.make({ legend: "All pass", value: result["pass^k"] }),
        Chart.Pie.make({ legend: "Not all pass", value: 1 - result["pass^k"] }),
      ],
    }),
  );
});

export const main = async () => {
  const result = await Effect.gen(function* () {
    const bench = yield* makeBench();
    const agent = yield* makeOpenAiCompat({
      apiKey: Config.string("OPENAI_API_KEY"),
      baseUrl: Config.string("OPENAI_BASE_URL"),
      dotenvPath: envPath,
      model: "deepseek-chat",
    });
    const sandbox = yield* Sandbox.Docker.make({});

    const harness = yield* Harness.make({
      id: "deepseek-agent",
      agent,
      sandbox,
    });

    return yield* Eval.run({
      bench,
      harness,
      config: { trailCount, verifMode: true },
    });
  }).pipe(Eval.toPromise);

  console.log(result);
};
