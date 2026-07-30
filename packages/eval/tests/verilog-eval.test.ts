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
import { Config, DateTime, Effect, Layer, Ref, Schema, Stream } from "effect";
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
const trailCount = 5;
const testTrailCount = 1;
const configuredTestTaskIds = process.env.VERILOG_EVAL_TASK_IDS?.split(",").filter(
  (id) => id.length > 0,
);
const testTaskCount = configuredTestTaskIds?.length ?? 10;

const current = import.meta.dirname!;
const envPath = path.resolve(current, "../../../.env");
const eventLogPath =
  process.env.VERILOG_EVAL_EVENT_LOG ?? "/tmp/open-insight/verilog-eval-events.jsonl";

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

const GradeFields = {
  simPass: Schema.Boolean,
  diagnostic: Schema.optionalKey(
    Schema.Struct({
      artifactPresent: Schema.Boolean,
      topV: Schema.NullOr(Schema.String),
      simulatorOutput: Schema.String,
    }),
  ),
};
const template = Task.Template.make({
  Extras: {
    category: Schema.String,
  },
  Grade: GradeFields,
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

    yield* Task.make(template)({
      id,
      name: id,
      snapshot,
      extras: { category: "verilog-eval" },
    }).pipe(
      Task.endStage("solve", {
        prompt: `${prompt.trimEnd()}\n\n${deliveryInstructions}`,
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

const testLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

layer(testLayer, { excludeTestServices: true })((it) => {
  it.effect(
    "evaluates configured Verilog tasks through the real API and publishes the event stream",
    () =>
      Effect.gen(function* () {
        const eventsRef = yield* Ref.make<ReadonlyArray<Event.Event>>([]);
        yield* Effect.tryPromise({
          try: async () => {
            await fs.mkdir(path.dirname(eventLogPath), { recursive: true });
            await fs.writeFile(eventLogPath, "", "utf8");
          },
          catch: Event.Error.send,
        });
        const transport = {
          send: (events: Event.EventStream) =>
            events.pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  const encoded = yield* Schema.encodeEffect(Event.Event)(event).pipe(
                    Effect.mapError(Event.Error.invalid),
                  );
                  yield* Effect.tryPromise({
                    try: () => fs.appendFile(eventLogPath, `${JSON.stringify(encoded)}\n`, "utf8"),
                    catch: Event.Error.send,
                  });
                  yield* Ref.update(eventsRef, (current) => [...current, event]);
                }),
              ),
            ),
        } satisfies Event.Transport.Transport;

        const bench = yield* configuredTestTaskIds === undefined
          ? makeBench().pipe(Bench.head(testTaskCount))
          : makeBench().pipe(Bench.select(configuredTestTaskIds));
        const agent = yield* makeOpenAiCompat({
          apiKey: Config.string("OPENAI_API_KEY"),
          baseUrl: Config.string("OPENAI_BASE_URL"),
          dotenvPath: envPath,
          model: "deepseek-v4-flash",
        });
        const harness = yield* Harness.make({
          id: "deepseek-agent",
          agent,
          sandbox: yield* Sandbox.Docker.make({}),
        });
        const result = yield* Eval.run({
          bench,
          harness,
          config: { trailCount: testTrailCount, verifMode: false },
        }).pipe(Effect.provideService(Event.Transport.Service, transport));
        const events = yield* Ref.get(eventsRef);
        const taskResults = Object.values(result.tasks);
        const expectedTaskIds = bench.tasks.map((task) => task.metadata.id).sort();
        const actualTaskIds = Object.keys(result.tasks).sort();
        const observations: Array<{
          task: string;
          trail: number;
          simPass: boolean;
          inputTokens: number | null;
          outputTokens: number | null;
          toolCalls: number;
          toolFailures: number;
          streamParts: number;
        }> = [];

        assert.lengthOf(taskResults, testTaskCount);
        assert.deepEqual(actualTaskIds, expectedTaskIds);
        assert.isNotEmpty(events);
        assert.strictEqual(events[0]?._tag, "InitEvent");

        for (const event of events) {
          assert.strictEqual(event.bench, bench.metadata.id);
          assert.strictEqual(event.harness, harness.metadata.id);
        }

        const initEvents = events.filter((event) => event._tag === "InitEvent");
        assert.lengthOf(initEvents, 1);
        const initEvent = initEvents[0];
        if (initEvent === undefined) {
          return assert.fail("Missing InitEvent");
        }
        assert.strictEqual(initEvent.benchMetadata.base.id, bench.metadata.id);
        assert.strictEqual(initEvent.harnessMetadata.base.id, harness.metadata.id);
        assert.deepEqual(
          initEvent.benchMetadata.tasks.map((task) => task.base.id).sort(),
          expectedTaskIds,
        );

        const evalScheduleEvents = events.filter((event) => event._tag === "EvalScheduleEvent");
        assert.deepEqual(
          evalScheduleEvents.map((event) => event.op),
          ["start", "stop"],
        );

        const stagedEvents = events.filter((event) => event._tag === "TrailStagedEvent");
        const streamEvents = events.filter((event) => event._tag === "TrailStreamEvent");
        const trajMetricEvents = events.filter((event) => event._tag === "TrajMetricEvent");
        const taskMetricEvents = events.filter((event) => event._tag === "TaskMetricEvent");
        const benchMetricEvents = events.filter((event) => event._tag === "BenchMetricEvent");

        for (const [task, taskResult] of Object.entries(result.tasks)) {
          const taskDefinition = bench.tasks.find((candidate) => candidate.metadata.id === task);
          if (taskDefinition === undefined) {
            return assert.fail(`Missing task definition for ${task}`);
          }

          assert.lengthOf(taskResult.trails, testTrailCount);
          assert.isAtMost(
            DateTime.toEpochMillis(taskResult.startedAt),
            DateTime.toEpochMillis(taskResult.finishedAt),
          );

          const taskScheduleEvents = events.filter(
            (event): event is Event.TaskScheduleEvent =>
              event._tag === "TaskScheduleEvent" && event.task === task,
          );
          assert.deepEqual(
            taskScheduleEvents.map((event) => event.op),
            ["start", "stop"],
          );

          const expectedTaskMetricIds = taskDefinition.metrics
            .map((metric) => metric.metadata.id)
            .sort();
          const currentTaskMetricEvents = taskMetricEvents.filter((event) => event.task === task);
          assert.deepEqual(
            currentTaskMetricEvents.map((event) => event.id).sort(),
            expectedTaskMetricIds,
          );
          for (const event of currentTaskMetricEvents) {
            assert.isNotNull(event.chart);
            assert.lengthOf(Object.keys(event.result), 1);
          }

          for (const [trailIdx, trail] of taskResult.trails.entries()) {
            const grade = yield* Schema.decodeUnknownEffect(template.Grade)(trail.grade);
            assert.isAtMost(
              DateTime.toEpochMillis(taskResult.startedAt),
              DateTime.toEpochMillis(trail.startedAt),
            );
            assert.isAtMost(
              DateTime.toEpochMillis(trail.startedAt),
              DateTime.toEpochMillis(trail.finishedAt),
            );
            assert.isAtMost(
              DateTime.toEpochMillis(trail.finishedAt),
              DateTime.toEpochMillis(taskResult.finishedAt),
            );
            assert.isNotEmpty(trail.trajectory.content);

            const trailScheduleEvents = events.filter(
              (event): event is Event.TrailScheduleEvent =>
                event._tag === "TrailScheduleEvent" &&
                event.task === task &&
                event.trailIdx === trailIdx,
            );
            assert.deepEqual(
              trailScheduleEvents.map((event) => event.op),
              ["start", "stop"],
            );

            const currentStagedEvents = stagedEvents.filter(
              (event) => event.task === task && event.trailIdx === trailIdx,
            );
            assert.lengthOf(currentStagedEvents, 1);
            const stagedEvent = currentStagedEvents[0];
            if (stagedEvent === undefined) {
              return assert.fail(`Missing staged event for ${task} trail ${trailIdx}`);
            }
            assert.strictEqual(stagedEvent.stage, taskDefinition.stages[0]?.metadata.id);
            assert.deepEqual(stagedEvent.grade, trail.grade);
            assert.deepEqual(stagedEvent.usage, trail.usage);

            const currentStreamEvents = streamEvents.filter(
              (event) => event.task === task && event.trailIdx === trailIdx,
            );
            const finishEvents = currentStreamEvents.filter(
              (event) => event.part.type === "finish",
            );
            assert.lengthOf(finishEvents, 1);
            const finishEvent = finishEvents[0];
            if (finishEvent === undefined || finishEvent.part.type !== "finish") {
              return assert.fail(`Missing finish event for ${task} trail ${trailIdx}`);
            }
            assert.deepEqual(finishEvent.part.usage, trail.usage);

            const toolCallEvents = currentStreamEvents.filter(
              (event) => event.part.type === "tool-call",
            );
            const toolResultEvents = currentStreamEvents.filter(
              (event) => event.part.type === "tool-result",
            );
            const currentTrajMetricEvents = trajMetricEvents.filter(
              (event) => event.task === task && event.trailIdx === trailIdx,
            );
            const expectedTrajMetricIds: ReadonlyArray<string> = taskDefinition.trajMetrics.map(
              (metric) => metric.metadata.id,
            );
            assert.lengthOf(
              currentTrajMetricEvents,
              toolResultEvents.length * expectedTrajMetricIds.length,
            );
            for (const metricId of expectedTrajMetricIds) {
              const metricEvents: ReadonlyArray<Event.TrajMetricEvent> =
                currentTrajMetricEvents.filter((event) => event.id === metricId);
              assert.lengthOf(metricEvents, toolResultEvents.length);
              for (const event of metricEvents) {
                assert.isNotNull(event.chart);
                assert.lengthOf(Object.keys(event.result), 1);
              }

              const finalMetricEvent = metricEvents.at(-1);
              if (finalMetricEvent !== undefined) {
                const countResult = finalMetricEvent.result.count;
                const rateResult = finalMetricEvent.result.rate;
                if (typeof countResult === "number") {
                  assert.strictEqual(countResult, toolCallEvents.length);
                } else if (typeof rateResult === "number") {
                  const failures = toolResultEvents.filter(
                    (event) => event.part.type === "tool-result" && event.part.isFailure,
                  ).length;
                  const expectedRate =
                    toolResultEvents.length === 0
                      ? 0
                      : (toolResultEvents.length - failures) / toolResultEvents.length;
                  assert.strictEqual(rateResult, expectedRate);
                } else {
                  return assert.fail(`Unexpected trajectory metric result for ${task}`);
                }
              }
            }

            const toolFailures = toolResultEvents.filter(
              (event) => event.part.type === "tool-result" && event.part.isFailure,
            ).length;
            observations.push({
              task,
              trail: trailIdx,
              simPass: grade.simPass,
              inputTokens: trail.usage.inputTokens.total ?? null,
              outputTokens: trail.usage.outputTokens.total ?? null,
              toolCalls: toolCallEvents.length,
              toolFailures,
              streamParts: currentStreamEvents.length,
            });
          }

          const passAtKValues = currentTaskMetricEvents.flatMap((event) => {
            const value = event.result["pass@k"];
            return typeof value === "number" ? [value] : [];
          });
          const passPowKValues = currentTaskMetricEvents.flatMap((event) => {
            const value = event.result["pass^k"];
            return typeof value === "number" ? [value] : [];
          });
          const grade = yield* Schema.decodeUnknownEffect(template.Grade)(
            taskResult.trails[0]?.grade,
          );
          assert.deepEqual(
            passAtKValues.sort((left, right) => left - right),
            [Number(grade.simPass), 1].sort((left, right) => left - right),
          );
          assert.deepEqual(passPowKValues, [0]);
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
        assert.isAtLeast(count("TrailStreamEvent"), completedTrailCount);

        const expectedBenchMetricIds = bench.metrics.map((metric) => metric.metadata.id).sort();
        assert.deepEqual(
          [...new Set(benchMetricEvents.map((event) => event.id))].sort(),
          expectedBenchMetricIds,
        );
        for (const metricId of expectedBenchMetricIds) {
          const metricEvents = benchMetricEvents.filter((event) => event.id === metricId);
          assert.lengthOf(metricEvents, completedTrailCount);
          for (const event of metricEvents) {
            assert.isNotNull(event.chart);
            assert.lengthOf(Object.keys(event.result), 1);
          }
        }

        const finalBenchMetricEvents = expectedBenchMetricIds.flatMap((metricId) => {
          const event = benchMetricEvents.filter((candidate) => candidate.id === metricId).at(-1);
          return event === undefined ? [] : [event];
        });
        assert.lengthOf(finalBenchMetricEvents, expectedBenchMetricIds.length);
        const finalPassAtKValues = finalBenchMetricEvents.flatMap((event) => {
          const value = event.result["pass@k"];
          return typeof value === "number" ? [value] : [];
        });
        const finalPassPowKValues = finalBenchMetricEvents.flatMap((event) => {
          const value = event.result["pass^k"];
          return typeof value === "number" ? [value] : [];
        });
        const passRate =
          observations.filter((observation) => observation.simPass).length / observations.length;
        assert.deepEqual(
          finalPassAtKValues.sort((left, right) => left - right),
          [passRate, 1].sort((left, right) => left - right),
        );
        assert.deepEqual(finalPassPowKValues, [0]);

        console.table(observations);
        console.log(
          "Event counts:",
          Object.fromEntries(
            Object.entries(eventCounts).map(([tag, taggedEvents]) => [tag, taggedEvents.length]),
          ),
        );
        console.log("Event log:", eventLogPath);
      }),
    1_200_000,
  );
});
