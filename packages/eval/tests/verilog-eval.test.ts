import {
  Bench,
  BenchMetric,
  Chart,
  Eval,
  Event,
  Grade,
  Harness,
  Sandbox,
  Snapshot,
  Task,
  TaskMetric,
  Tasks,
  TrajMetric,
  When,
} from "@open-insight/eval";
import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { makeOpenAiCompat } from "@open-insight/agent";
import { Spawn } from "@open-insight/core/utils";
import { Config, Effect, Layer, Ref, Schema, Stream } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";
const trailCount = 5;
const testTaskCount = 10;
const testTrailCount = 1;

const current = import.meta.dirname!;
const envPath = path.resolve(current, "../../../.env");

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

class TaskExtras extends Schema.Class<TaskExtras>("VerilogEvalTaskExtras")({
  category: Schema.String,
}) {}

class GradeResult extends Schema.Class<GradeResult>("VerilogEvalGradeResult")({
  simPass: Schema.Boolean,
}) {}

const deepSeekAgent = makeOpenAiCompat({
  apiKey: Config.string("OPENAI_API_KEY"),
  baseUrl: Config.string("OPENAI_BASE_URL"),
  dotenvPath: envPath,
  model: "deepseek-chat",
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
      extras: { schema: TaskExtras, value: { category: "verilog-eval" } },
    })
      .pipe(
        Task.stage("solve", {
          prompt,
          grader: Grade.make(
            GradeResult,
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

              const output = await $`if \\
                  cp top.v /tmp/verilog-eval/top.v && \\
                  cd /tmp/verilog-eval && \\
                  iverilog -g2012 -s tb -o simv top.v ref.sv test.sv; \\
                then \\
                  vvp simv || true; \\
                fi`;

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
      .pipe(
        Task.metric(
          TaskMetric.passAtK(1).pipe(TaskMetric.mapGrade(({ simPass }) => ({ pass: simPass }))),
          {
            name: "Pass@1",
            description: "Estimated probability that one generated RTL solution passes simulation.",
            chart: (result) => [
              Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
              Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
            ],
          },
        ),
        Task.metric(
          TaskMetric.passAtK(trailCount).pipe(
            TaskMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
          ),
          {
            name: `Pass@${trailCount}`,
            description: `Estimated probability that at least one of ${trailCount} solutions passes.`,
            chart: (result) => [
              Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
              Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
            ],
          },
        ),
        Task.metric(
          TaskMetric.passPowK(trailCount).pipe(
            TaskMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
          ),
          {
            name: `Pass power ${trailCount}`,
            description: `Estimated probability that all ${trailCount} solutions pass.`,
            chart: (result) => [
              Chart.Pie.make({ legend: "All pass", value: result["pass^k"] }),
              Chart.Pie.make({ legend: "Not all pass", value: 1 - result["pass^k"] }),
            ],
          },
        ),
        Task.trajMetric(TrajMetric.toolCallCount(), {
          name: "Tool call count",
          description: "Cumulative number of tool calls made while solving the task.",
          chart: ({ count }) => [
            Chart.Bar.make({ legend: "Tool calls", x: "Completed", y: count }),
          ],
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
    Bench.metric(
      BenchMetric.avgPassAtK(1).pipe(BenchMetric.mapGrade(({ simPass }) => ({ pass: simPass }))),
      {
        name: "Average pass at 1",
        description: "Mean pass@1 estimate across evaluated tasks.",
        chart: (result) => [
          Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
          Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
        ],
      },
    ),
    Bench.metric(
      BenchMetric.avgPassAtK(trailCount).pipe(
        BenchMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
      ),
      {
        name: `Average pass at ${trailCount}`,
        description: `Mean pass@${trailCount} estimate across evaluated tasks.`,
        chart: (result) => [
          Chart.Pie.make({ legend: "Pass", value: result["pass@k"] }),
          Chart.Pie.make({ legend: "Fail", value: 1 - result["pass@k"] }),
        ],
      },
    ),
    Bench.metric(
      BenchMetric.avgPassPowK(trailCount).pipe(
        BenchMetric.mapGrade(({ simPass }) => ({ pass: simPass })),
      ),
      {
        name: `Average pass power ${trailCount}`,
        description: `Mean pass^${trailCount} estimate across evaluated tasks.`,
        chart: (result) => [
          Chart.Pie.make({ legend: "All pass", value: result["pass^k"] }),
          Chart.Pie.make({ legend: "Not all pass", value: 1 - result["pass^k"] }),
        ],
      },
    ),
  );
});

export const main = async () => {
  const result = await Effect.gen(function* () {
    const bench = yield* makeBench();
    const agent = yield* deepSeekAgent;

    const harness = yield* Harness.make({
      id: "deepseek-agent",
      agent,
      sandbox: yield* Sandbox.Docker.make({}),
    });

    return yield* Eval.run({
      bench,
      harness,
      config: { trailCount, verifMode: true },
    });
  }).pipe(Eval.toPromise);

  console.log(result);
};

const testLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

layer(testLayer, { excludeTestServices: true })((it) => {
  it.effect(
    "evaluates the first 10 Verilog tasks once and publishes the complete event stream",
    () =>
      Effect.gen(function* () {
        const eventsRef = yield* Ref.make<ReadonlyArray<Event.Event>>([]);
        const transport = {
          send: (events: Event.EventStream) =>
            events.pipe(
              Stream.runForEach((event) => Ref.update(eventsRef, (current) => [...current, event])),
            ),
        } satisfies Event.Transport.Transport;

        const bench = yield* makeBench().pipe(Bench.head(testTaskCount));
        const agent = yield* deepSeekAgent;
        const harness = yield* Harness.make({
          id: "deepseek-agent",
          agent,
          sandbox: yield* Sandbox.Docker.make({}),
        });
        const result = yield* Eval.run({
          bench,
          harness,
          config: { trailCount: testTrailCount, verifMode: true },
        }).pipe(Effect.provideService(Event.Transport.Service, transport));
        const events = yield* Ref.get(eventsRef);
        const taskResults = Object.values(result.tasks);

        assert.lengthOf(taskResults, testTaskCount);
        for (const taskResult of taskResults) {
          assert.lengthOf(taskResult.trails, testTrailCount);
          for (const trail of taskResult.trails) {
            const grade = yield* Schema.decodeUnknownEffect(GradeResult)(trail.grade);
            assert.strictEqual(grade.simPass, true);
          }
        }

        const eventCounts = Object.groupBy(events, (event) => event._tag);
        const count = (tag: Event.Event["_tag"]) => eventCounts[tag]?.length ?? 0;
        const completedTrailCount = taskResults.length * testTrailCount;

        assert.strictEqual(count("InitEvent"), 1);
        assert.strictEqual(count("EvalScheduleEvent"), 2);
        assert.strictEqual(count("TaskScheduleEvent"), taskResults.length * 2);
        assert.strictEqual(count("TrailScheduleEvent"), completedTrailCount * 2);
        assert.strictEqual(count("TrailStagedEvent"), completedTrailCount);
        assert.strictEqual(count("TaskMetricEvent"), completedTrailCount * 3);
        assert.strictEqual(count("BenchMetricEvent"), completedTrailCount * 3);
        assert.strictEqual(count("TrajMetricEvent"), 0);
        assert.strictEqual(count("TrailStreamEvent"), completedTrailCount);

        for (const task of Object.keys(result.tasks)) {
          for (let trailIdx = 0; trailIdx < testTrailCount; trailIdx++) {
            const streamEvents = events.filter(
              (event) =>
                event._tag === "TrailStreamEvent" &&
                event.task === task &&
                event.trailIdx === trailIdx,
            );
            assert.lengthOf(streamEvents, 1);
            const streamEvent = streamEvents[0];
            if (streamEvent?._tag !== "TrailStreamEvent") {
              return assert.fail(`Missing stream event for ${task} trail ${trailIdx}`);
            }
            assert.strictEqual(streamEvent.part.type, "finish");
          }
        }
      }),
    1_200_000,
  );
});
