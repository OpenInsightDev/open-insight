import { NodeServices } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import {
  Agent,
  Bench,
  Chart,
  Eval,
  Event,
  Grade,
  Harness,
  Metric,
  Sandbox,
  Snapshot,
  Task,
} from "@open-insight/eval";
import { Spawn } from "@open-insight/core/utils";
import { Effect, Layer, Queue } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const datasetDirName = "dataset_spec-to-rtl";
const promptSuffix = "_prompt.txt";
const taskCount = 4;
const trailCount = 3;

const testLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

const hasNoMismatches = (output: string): boolean =>
  /Mismatches:\s*0\s+in\s+\d+\s+samples/.test(output);

async function loadTasks(repoPath: string) {
  const datasetDir = path.join(repoPath, datasetDirName);
  const promptFiles = (await fs.readdir(datasetDir)).filter((file) => file.endsWith(promptSuffix));

  const snapshot = Snapshot.make({
    image: "ubuntu:latest",
    instructions: [
      Snapshot.run("apt-get update && apt-get install -y iverilog && rm -rf /var/lib/apt/lists/*"),
    ],
  });

  const tasks = promptFiles.map(async (promptFile) => {
    const id = promptFile.slice(0, -promptSuffix.length);

    const refPath = path.join(datasetDir, `${id}_ref.sv`);
    const testPath = path.join(datasetDir, `${id}_test.sv`);

    return Task.make({
      id,
      name: id,
      snapshot,
      extras: { category: "verilog-eval" },
    })
      .pipe(
        Task.metric(async () => ({ score: 1 })),
        Task.trajMetric(async () => ({ category: "verilog-eval" })),
      )
      .pipe(
        Task.stage("solve", {
          prompt: await fs.readFile(path.join(datasetDir, promptFile), "utf8"),
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

              const output =
                await $`cp top.v /tmp/verilog-eval/top.v && cd /tmp/verilog-eval && iverilog -g2012 -s tb -o simv top.v ref.sv test.sv && vvp simv`;
              return { simPass: hasNoMismatches(output) };
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
      .pipe(Task.satisfies<{ simPass: boolean }, { category: string }>());
  });

  return Promise.all(tasks);
}

// it.live(
//   "passes the reference implementation through the Verilog simulator",
//   () =>
//     Effect.gen(function* () {
//       const repoPath = path.resolve(import.meta.dirname, "../../../.repos/verilog-eval");
//       const tasks = yield* Effect.promise(() => loadTasks(repoPath)).pipe(
//         Effect.flatMap((effects) => Effect.all(effects)),
//       );
//       const benchmark = yield* Bench.make({
//         id: "verilog-eval",
//         tasks: Effect.succeed(tasks),
//         metrics: [benchMetric("average-pass-at-1", 1), benchMetric("average-pass-at-3", 3)],
//       }).pipe(Bench.head(taskCount));

//       const agent = yield* Agent.Dummy.make({});
//       const sandbox = yield* Sandbox.Docker.make({});
//       const harness = yield* Harness.make({ id: "verilog-eval-verifier" }).pipe(
//         Effect.provideService(Agent.ProviderService, agent),
//         Effect.provideService(Sandbox.ProviderService, sandbox),
//       );
//       const executor = yield* Eval.make({ benchmark, harness, trailCount });
//       const eventQueue = yield* Queue.unbounded<Event.Event, Event.Error>();

//       yield* Eval.Schedule.run(
//         {
//           trailCount: executor.trailCount,
//           bench: executor.benchmark,
//           harness: executor.harness,
//           eventQueue,
//         },
//         {
//           cacheTaskSnapshot: true,
//           cacheAgentSnapshot: true,
//           otel: {},
//           snapshotConcurrency: 1,
//           taskConcurrency: 1,
//           trailConcurrency: 1,
//           graderMaxRetries: 0,
//           verifMode: true,
//         },
//       ).pipe(Effect.provide(harness.layer));

//       const events = yield* Queue.takeAll(eventQueue);
//       const stageEvents = events.filter((event) => event._tag === "TrailStagedEvent");
//       const taskMetricEvents = events.filter((event) => event._tag === "TaskMetricEvent");
//       const benchMetricEvents = events.filter((event) => event._tag === "BenchMetricEvent");

//       assert.lengthOf(stageEvents, taskCount * trailCount);
//       assert.isTrue(stageEvents.every(({ grade }) => grade.simPass === true));
//       assert.lengthOf(taskMetricEvents, taskCount * trailCount * 2);
//       assert.isTrue(taskMetricEvents.every(({ result }) => result.score === 1));
//       assert.lengthOf(benchMetricEvents, taskCount * trailCount * 2);
//       assert.isTrue(benchMetricEvents.every(({ result }) => result.score === 1));
//     }).pipe(Effect.provide(testLayer)),
//   { timeout: 180_000 },
// );
