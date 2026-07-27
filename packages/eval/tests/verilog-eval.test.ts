import {
  Agent,
  Bench,
  Chart,
  Eval,
  Grade,
  Harness,
  Metric,
  Sandbox,
  Snapshot,
  Task,
  Tasks,
  When,
} from "@open-insight/eval";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";
const trailCount = 5;

const current = import.meta.dirname!;

// const snapshot = Snapshot.make({
//   image: "ubuntu:24.04",
//   context: path.resolve(current),
//   instructions: [
//     Snapshot.run(
//       `DEBIAN_FRONTEND=noninteractive apt-get update && \\
//        apt-get install -y --no-install-recommends \\
//             build-essential git curl ca-certificates \\
//             python3 python3-dev python3-pip python3-venv \\
//             gperf flex bison autoconf automake libtool make perl help2man \\
//             libfl2 libfl-dev zlib1g zlib1g-dev \\
//             tcl-dev libreadline-dev libffi-dev pkg-config \\
//             && rm -rf /var/lib/apt/lists/*`,
//     ),
//     Snapshot.run(
//       `git clone --depth 1 --branch v12_0 \\
//        https://github.com/steveicarus/iverilog.git /tmp/iverilog && \\
//        cd /tmp/iverilog && sh autoconf.sh && \\
//        ./configure --prefix=/usr/local && make -j$(nproc) && make install && \\
//        rm -rf /tmp/iverilog`,
//     ),
//     Snapshot.workdir(`/workspace`),
//   ],
// });
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

type GradeResult = Readonly<{ simPass: boolean }>;
type Extras = Readonly<{ category: string }>;

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
      extras: { category: "verilog-eval" },
    })
      .pipe(
        Task.stage("solve", {
          prompt,
          grader: Grade.make(
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

              const hasNoMismatches = (output: string): boolean =>
                /Mismatches:\s*0\s+in\s+\d+\s+samples/.test(output);

              const output = await $`cp top.v /tmp/verilog-eval/top.v && \\
                  cd /tmp/verilog-eval && \\
                  iverilog -g2012 -s tb -o simv top.v ref.sv test.sv && \\
                  vvp simv`;

              return { simPass: hasNoMismatches(output) } satisfies GradeResult;
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
      )
      .pipe(Task.satisfies<GradeResult, Extras>())
      .pipe(
        Task.metric(Metric.Task.passAtK(1, "simPass"), {
          name: "Pass at 1",
          description: "Estimated probability that one generated RTL solution passes simulation.",
          chart: (result) => [
            Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
            Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
          ],
        }),
        Task.metric(Metric.Task.passAtK(trailCount, "simPass"), {
          name: `Pass at ${trailCount}`,
          description: `Estimated probability that at least one of ${trailCount} solutions passes.`,
          chart: (result) => [
            Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
            Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
          ],
        }),
        Task.metric(Metric.Task.passPowK(trailCount, "simPass"), {
          name: `Pass power ${trailCount}`,
          description: `Estimated probability that all ${trailCount} solutions pass.`,
          chart: (result) => [
            Chart.Pie.make({ legend: "All pass", value: result["pass^k"] }),
            Chart.Pie.make({ legend: "Not all pass", value: 1 - result["pass^k"] }),
          ],
        }),
        Task.trajMetric(Metric.Traj.toolCallCount(), {
          name: "Tool call count",
          description: "Cumulative number of tool calls made while solving the task.",
          chart: ({ count }) => [
            Chart.Bar.make({ legend: "Tool calls", x: "Completed", y: count }),
          ],
          when: When.traj(When.toolCall()),
        }),
        Task.trajMetric(Metric.Traj.toolCallSuccessRate(), {
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
    Bench.metric({
      name: "Average pass at 1",
      description: "Mean pass@1 estimate across evaluated tasks.",
      exec: Metric.Bench.avgPassAtK(1, "simPass"),
      chart: (result) => [
        Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
        Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
      ],
    }),
    Bench.metric({
      name: `Average pass at ${trailCount}`,
      description: `Mean pass@${trailCount} estimate across evaluated tasks.`,
      exec: Metric.Bench.avgPassAtK(trailCount, "simPass"),
      chart: (result) => [
        Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
        Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
      ],
    }),
    Bench.metric({
      name: `Average pass power ${trailCount}`,
      description: `Mean pass^${trailCount} estimate across evaluated tasks.`,
      exec: Metric.Bench.avgPassPowK(trailCount, "simPass"),
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

    // const config = OpenAiClient.layerConfig({
    //   apiKey: Config.redacted("OPENAI_API_KEY"),
    // }).pipe(Layer.provide(FetchHttpClient.layer));
    // const model = OpenAiLanguageModel.model("gpt-5.6-luna").pipe(Layer.provide(config));
    // const agent = yield* Agent.Effect.make().pipe(Effect.provide(model));

    const agent = yield* Agent.Dummy.make();

    const harness = yield* Harness.make({
      id: "dummy-agent",
      agent,
      sandbox: yield* Sandbox.Docker.make({}),
    });

    return yield* Eval.run({
      bench,
      harness,
      config: { trailCount },
    });
  }).pipe(Eval.toPromise);

  console.log(result);
};
