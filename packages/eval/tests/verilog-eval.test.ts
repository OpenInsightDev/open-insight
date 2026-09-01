import { Effect, FileSystem, Path, Schema } from "effect";
import { Grade, Snapshot, Task, Resource, Bench, Tasks } from "#/export.ts";
import { isNotNull } from "effect/Predicate";

const loadTasks = Effect.fn(function* (repoPath: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const datasetDirName = "dataset_spec-to-rtl";
  const promptSuffix = "_prompt.txt";

  const datasetDir = path.resolve(repoPath, datasetDirName);

  const snapshot = Snapshot.makeTemplate({
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

  const entries = yield* fs.readDirectory(datasetDir);

  const mapEntry = Effect.fn(function* (entry: string) {
    const stat = yield* fs.stat(path.resolve(datasetDir, entry));

    if (stat.type !== "File" || !entry.endsWith(promptSuffix)) {
      return null;
    }

    const id = entry.slice(0, -promptSuffix.length);
    const rawPrompt = yield* fs.readFileString(path.join(datasetDir, entry));
    const prompt = `${rawPrompt.trimEnd()}. Complete the task by writing the full Verilog solution to /workspace/top.v.`;

    const refPath = path.resolve(datasetDir, `${id}_ref.sv`);
    const testPath = path.resolve(datasetDir, `${id}_test.sv`);

    const grader = Grade.embed(
      Schema.Struct({ simPass: Schema.Boolean, category: Schema.String }),
      Effect.fn(function* ({ $, upload }) {
        yield* $`mkdir -p /tmp/verilog-eval`;

        yield* upload({
          hostPath: refPath,
          sandboxPath: "/tmp/verilog-eval/ref.sv",
        });
        yield* upload({
          hostPath: testPath,
          sandboxPath: "/tmp/verilog-eval/test.sv",
        });

        if (id === "Prob099_m2014_q6c") {
          // VerilogEval issue #13: the testbench names Y1/Y3 as Y2/Y4.
          yield* $`sed -i -e 's/\.Y2(/.Y1(/g' -e 's/\.Y4(/.Y3(/g' /tmp/verilog-eval/test.sv`;
        }

        // Mirror the upstream harness (Makefile.in sv-iv-test target):
        // compile the solution with the testbench and reference module
        // using the same iverilog flags and top-module selection, then
        // simulate under the same 30s timeout, appending a TIMEOUT
        // marker on expiry exactly like the Makefile does.
        const output = yield* $`if \\
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

        const topV = yield* $`if [ -f top.v ]; then cat top.v; fi`.pipe(
          Effect.map((s) => s.trimEnd()),
        );

        const { simPass, category } = analyzeVerilogEval(output, topV);
        return { simPass, category };
      }),
    );

    const task = Task.make(id, {
      prompt,
      grader,
      snapshot,
      resources: Resource.providerDefault,
    });

    return task.pipe(
      Task.result(
        Schema.Struct({ passAt1: Schema.Number }),
        Effect.fn(function* (trails) {
          return { passAt1: trails.length };
        }),
      ),
    );
  });

  return yield* Effect.all(entries.map(mapEntry)).pipe(Effect.flatMap(Effect.filter(isNotNull)));
});

export const makeBench = Effect.fn(function* () {
  const tasks = yield* Tasks.withGithub("NVlabs/verilog-eval", {
    branch: "main",
    commit: "c498220d0a52248f8e3fdffe279075215bde2da6",
  }).pipe(Effect.flatMap(loadTasks));

  return Bench.fromArray("VerilogEval", tasks);
});

const main = Effect.fn(function* () {
  const bench = yield* makeBench().pipe();
});
