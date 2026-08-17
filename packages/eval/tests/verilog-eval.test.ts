import { Bench, Grade, Snapshot, Task, Tasks, Eval, env, envify } from "@open-insight/eval";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";
import { Acp, Sandbox } from "@open-insight/core";
import { NodeServices } from "@effect/platform-node";

export class GradeResult extends Schema.Class<GradeResult>("GradeResult")({
  /**
   * True if the simulation passed (i.e., no mismatches were found)
   */
  simPass: Schema.Boolean,
  /**
   * sv-iv-analyze pass/fail category over the combined iverilog compile +
   * simulation log: "." = pass, otherwise the failure code (S/C/e/0/n/w/m/p/c/T/r/R).
   */
  category: Schema.String,
}) {}

export class Extra extends Schema.Class<Extra>("Extra")({
  category: Schema.String,
}) {}

const makeTask = Task.make(GradeResult, Extra);

/**
 * Port of scripts/sv-iv-analyze's analyze_result() over the combined
 * compile + simulation log, preserving the classification order and the
 * pass condition (a `Mismatches: 0 in N samples` line with no prior
 * failure classification).
 */
const analyzeVerilogEval = (
  log: string,
  solution: string,
): { simPass: boolean; category: string } => {
  let category: string | null = null;
  let errorC = false;
  let errorP = false;
  let noMismatch = false;

  for (const line of log.split("\n")) {
    if (line.includes("syntax error")) {
      category = "S";
      break;
    }
    if (line.includes("error")) errorC = true;
    if (line.includes("error: This assignment requires an explicit cast")) {
      category = "e";
      break;
    }
    if (line.includes("error: Sized numeric constant must have a size greater than zero")) {
      category = "0";
      break;
    }
    if (line.includes("warning: always_comb process has no sensitivities")) {
      category = "n";
      break;
    }
    if (line.includes("found no sensitivities so it will never trigger")) {
      category = "n";
      break;
    }
    if (line.includes("is declared here as wire")) {
      category = "w";
      break;
    }
    if (line.includes("Unknown module type")) {
      category = "m";
      break;
    }
    if (line.includes("Unable to bind wire/reg")) errorP = true;
    if (line.includes("Unable to bind wire/reg/memory `clk'")) {
      category = "c";
      break;
    }
    if (line.includes("TIMEOUT")) {
      category = "T";
      break;
    }
    const match = /^Mismatches: (\d+) in \d+ samples$/.exec(line);
    if (match !== null && Number(match[1]) === 0) noMismatch = true;
  }

  if (category === null && errorP) category = "p";
  if (category === null && errorC) category = "C";
  if (category === null && noMismatch) category = ".";

  if (category === null) {
    // No mismatch summary was printed: scan the generated Verilog for the
    // reset idioms the analyzer checks, otherwise report a runtime failure.
    category = /posedge reset|negedge reset|posedge r\)/.test(solution) ? "r" : "R";
  }

  return { simPass: category === ".", category };
};

async function* loadTasks(repoPath: string) {
  const datasetDirName = "dataset_spec-to-rtl";
  const promptSuffix = "_prompt.txt";

  const datasetDir = resolve(repoPath, datasetDirName);

  const snapshot = Snapshot.makeTemplateWith({
    image: "ubuntu:24.04",
    context: import.meta.dirname,
    instructions: [
      Snapshot.run(
        `DEBIAN_FRONTEND=noninteractive apt-get update && \\
         apt-get install -y --no-install-recommends \\
              ca-certificates \\
              curl \\
              iverilog=12.0* && \\
         rm -rf /var/lib/apt/lists/*`,
      ),
      Snapshot.available("iverilog", "vvp"),
      Snapshot.workdir("/workspace"),
    ],
  });

  const entries = await readdir(datasetDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(promptSuffix)) {
      continue;
    }

    const id = entry.name.slice(0, -promptSuffix.length);
    const prompt = await readFile(resolve(datasetDir, entry.name), "utf8");
    const refPath = resolve(datasetDir, `${id}_ref.sv`);
    const testPath = resolve(datasetDir, `${id}_test.sv`);

    yield* makeTask({
      id,
      name: id.toLocaleUpperCase(),
      snapshot,
      prompt: `${prompt.trimEnd()}. Complete the task by writing the full Verilog solution to /workspace/top.v.`,
      category: "VerilogEval",
      grader: Grade.embed(
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
            // VerilogEval issue #13: the testbench names Y1/Y3 as Y2/Y4.
            await $`sed -i -e 's/\.Y2(/.Y1(/g' -e 's/\.Y4(/.Y3(/g' /tmp/verilog-eval/test.sv`;
          }

          // Mirror the upstream harness (Makefile.in sv-iv-test target):
          // compile the solution with the testbench and reference module
          // using the same iverilog flags and top-module selection, then
          // simulate under the same 30s timeout, appending a TIMEOUT
          // marker on expiry exactly like the Makefile does.
          const output = await $`if \\
                    cp top.v /tmp/verilog-eval/top.v && \\
                    cd /tmp/verilog-eval && \\
                    iverilog -Wall -Winfloop -Wno-timescale -g2012 -s tb -o simv top.v test.sv ref.sv; \\
                  then \\
                    if [ -f simv ]; then \\
                      timeout 30 ./simv; \\
                      rc=$?; \\
                      if [ $rc -eq 124 ]; then echo "TIMEOUT"; fi; \\
                    fi; \\
                  fi 2>&1`;

          // sv-iv-analyze scans the generated Verilog when the log has no
          // mismatch summary, so capture the solution artifact as well.
          const topV = (await $`if [ -f top.v ]; then cat top.v; fi`).trim();

          if (process.env.VERILOG_EVAL_DEBUG === "1") {
            console.log(`[VERILOG-EVAL][${id}] === top.v ===`);
            console.log(topV);
            console.log(`[VERILOG-EVAL][${id}] === iverilog+sim output ===`);
            console.log(output);
          }

          const { simPass, category } = analyzeVerilogEval(output, topV);

          return { simPass, category };
        },
        {
          verif: {
            exec: async ({ upload, $ }) => {
              await upload({ hostPath: refPath, sandboxPath: "/tmp/ref.sv" });
              await $`sed 's/RefModule/TopModule/g' /tmp/ref.sv > top.v`;
              return null;
            },
            expect: { simPass: true, category: "." },
          },
        },
      ),
    });
    // .pipe(
    //   Task.mapMetric(({ simPass }) => ({ pass: simPass }), TaskMetric.passAtK(1), {
    //     name: "Pass@1",
    //     description: "Whether the task was solved in the first trial.",
    //     chart: ({ "pass@k": pass }) => [
    //       Chart.Pie.make({ legend: "Pass", value: pass }),
    //       Chart.Pie.make({ legend: "Fail", value: 1 - pass }),
    //     ],
    //   }),
    //   Task.trajMetric(TrajMetric.toolCallCount(), {
    //     name: "Tool call count",
    //     description: "Cumulative number of tool calls made while solving the task.",
    //     chart: ({ count }) => [Chart.Bar.make({ legend: "Tool calls", x: "Completed", y: count })],
    //     when: When.traj(When.toolCall()),
    //   }),
    //   Task.trajMetric(TrajMetric.toolCallSuccessRate(), {
    //     when: When.traj(When.toolCall()),
    //     name: "Tool call success rate",
    //     description: "Share of completed tool calls that succeeded.",
    //     chart: ({ rate }) => [
    //       Chart.Pie.make({ legend: "Succeeded", value: rate }),
    //       Chart.Pie.make({ legend: "Failed", value: 1 - rate }),
    //     ],
    //   }),
    // );
  }
}

export const makeBench = Effect.fn("verilog-eval/makeBench")(function* () {
  return yield* Bench.make(
    "verilog-eval",
    Tasks.withGithub("NVlabs/verilog-eval", {
      branch: "main",
      commit: "c498220d0a52248f8e3fdffe279075215bde2da6",
    })((repoPath) => Tasks.fromAsyncIter(loadTasks(repoPath))),
  );
  // .pipe(
  //   Bench.mapMetric(({ simPass }) => ({ pass: simPass }), BenchMetric.avgPassAtK(1), {
  //     name: "Average pass@1",
  //     description: "Mean pass@1 estimate across evaluated tasks.",
  //     chart: (result) => [
  //       Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
  //       Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
  //     ],
  //   }),
  // );
});

const envPath = new URL("../../../.env", import.meta.url);
process.loadEnvFile(envPath);

const openAiApiKey = env("OPENAI_API_KEY");
const openAiBaseUrl = env("OPENAI_BASE_URL");
const openAiModel = env("OPENAI_MODEL");
const serveEnv = envify({
  OPENAI_API_KEY: openAiApiKey,
  OPENAI_BASE_URL: openAiBaseUrl,
  OPENAI_MODEL: openAiModel,
  DEFAULT_AUTH_REQUEST: { methodId: "api-key" },
  NO_BROWSER: "1",
  INITIAL_AGENT_MODE: "agent-full-access",
  CODEX_CONFIG: {
    model: openAiModel,
    model_provider: "deepseek",
    model_providers: {
      deepseek: {
        name: "DeepSeek",
        base_url: openAiBaseUrl,
        wire_api: "responses",
        env_key: "OPENAI_API_KEY",
      },
    },
  },
});

const main = Effect.gen(function* () {
  const bench = yield* makeBench().pipe(Bench.sample("5%"));
  const result = yield* Eval.run(bench, { trailCount: 2 })
    .pipe(Eval.result)
    .pipe(Effect.provide(Acp.layerFrom("codex-acp", { serveEnv })))
    .pipe(Effect.provide(Sandbox.Docker.layerFrom({ ports: [7689] })));

  console.log(result);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

await Effect.runPromise(main);
