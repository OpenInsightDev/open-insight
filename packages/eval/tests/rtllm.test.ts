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

const rtllmCommit = "41b26896e33b536940116a975626455eed3de65e";
const deliveryInstructions = [
  "Complete the task by writing the full Verilog solution to /workspace/design.v.",
  "The grader reads only /workspace/design.v; code in chat or any other path is not submitted.",
  "Include every module needed by the design in that file.",
  "Before finishing, confirm that /workspace/design.v contains the complete submitted artifact.",
].join("\n");
const trailCount = 5;
const testTrailCount = 1;
const configuredTestTaskIds = process.env.RTLLM_EVAL_TASK_IDS?.split(",").filter(
  (id) => id.length > 0,
);
const testTaskCount = configuredTestTaskIds?.length ?? 10;

const current = import.meta.dirname!;
const envPath = path.resolve(current, "../../../.env");
const eventLogPath =
  process.env.RTLLM_EVAL_EVENT_LOG ?? "/tmp/open-insight/rtllm-eval-events.jsonl";

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
    Snapshot.workdir("/workspace"),
  ],
});

const template = Task.Template.make({
  Extras: {
    category: Schema.String,
  },
  Grade: {
    syntaxPass: Schema.Boolean,
    simPass: Schema.Boolean,
    diagnostic: Schema.optionalKey(
      Schema.Struct({
        artifactPresent: Schema.Boolean,
        designV: Schema.NullOr(Schema.String),
        compilerOutput: Schema.String,
        simulatorOutput: Schema.String,
      }),
    ),
  },
});

async function* findDesignDirs(directory: string): AsyncGenerator<string> {
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));

  if (fileNames.has("design_description.txt") && fileNames.has("testbench.v")) {
    yield directory;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== ".git") {
      yield* findDesignDirs(path.resolve(directory, entry.name));
    }
  }
}

async function* loadTasks(repoPath: string) {
  for await (const designDir of findDesignDirs(repoPath)) {
    const relativePath = path.relative(repoPath, designDir);
    const id = relativePath.split(path.sep).join("/");
    const category = relativePath.split(path.sep)[0] ?? "Uncategorized";
    const prompt = await fs.readFile(path.resolve(designDir, "design_description.txt"), "utf8");
    const testbenchPath = path.resolve(designDir, "testbench.v");
    const designFiles = await fs.readdir(designDir);
    const verifiedFile = designFiles
      .filter((name) => name.startsWith("verified_") && name.endsWith(".v"))
      .sort()[0];
    const supportFiles = designFiles
      .filter((name) => name.endsWith(".dat") || name.endsWith(".txt"))
      .filter((name) => name !== "design_description.txt")
      .sort();

    if (verifiedFile === undefined) {
      throw new Error(`Missing verified RTL for ${id}`);
    }
    const verifiedPath = path.resolve(designDir, verifiedFile);

    yield* Task.make(template)({
      id,
      name: id,
      snapshot,
      extras: { category },
    }).pipe(
      Task.endStage("solve", {
        prompt: `${prompt.trimEnd()}\n\n${deliveryInstructions}`,
        grader: Grade.make(
          async ({ upload, $ }) => {
            await $`mkdir -p /tmp/rtllm`;
            await upload({
              hostPath: testbenchPath,
              sandboxPath: "/tmp/rtllm/testbench.v",
            });
            for (const supportFile of supportFiles) {
              await upload({
                hostPath: path.resolve(designDir, supportFile),
                sandboxPath: `/tmp/rtllm/${supportFile}`,
              });
            }
            if (id === "Control/Counter/ring_counter") {
              await $`sed -i \
              -e 's/reg \[7:0\] data \[0:9\] = {.*};/reg [7:0] data [0:9];/' \
              -e '/^[[:space:]]*initial begin/a\
        data[0]=1; data[1]=1; data[2]=2; data[3]=4; data[4]=8;\
        data[5]=16; data[6]=32; data[7]=64; data[8]=128; data[9]=1;' \
              -e 's/if (i == 9)/if (i >= 9)/' \
              -e 's/#100 \$finish;/#110 \$finish;/' \
              /tmp/rtllm/testbench.v`;
            }
            if (id === "Memory/FIFO/asyn_fifo") {
              await $`sed -i \
              -e '/^[[:space:]]*initial begin[[:space:]]*$/ { N; /repeat (17)/s/initial begin/initial begin : fill_fifo/; }' \
              -e 's/break;/disable fill_fifo;/' \
              /tmp/rtllm/testbench.v`;
            }
            if (id === "Miscellaneous/RISC-V/clkgenerator") {
              await $`sed -i \
              -e 's/#5; \/\/ Time delay between clock cycles/#4; \/\/ Sample before the clock edge/' \
              -e '/res = res + 1;/a\            #1;' \
              /tmp/rtllm/testbench.v`;
            }

            const artifactPresent =
              (await $`if [ -f design.v ]; then printf present; else printf missing; fi`).trim() ===
              "present";
            const designV = artifactPresent ? await $`cat design.v` : null;
            const compilerOutput = await $`if [ ! -f design.v ]; then \
                  printf 'Missing /workspace/design.v\n'; \
                elif iverilog -g2012 -o /tmp/rtllm/simv design.v /tmp/rtllm/testbench.v; then \
                  printf '\n__RTLLM_COMPILE_OK__\n'; \
                fi 2>&1`;
            const syntaxPass = compilerOutput.includes("__RTLLM_COMPILE_OK__");
            const simulatorOutput = syntaxPass
              ? await $`cd /tmp/rtllm && timeout 30s vvp simv 2>&1 || true`
              : "";
            const simPass = syntaxPass && /Your Design Passed/.test(simulatorOutput);

            return {
              syntaxPass,
              simPass,
              ...(simPass
                ? {}
                : {
                    diagnostic: {
                      artifactPresent,
                      designV,
                      compilerOutput,
                      simulatorOutput,
                    },
                  }),
            };
          },
          {
            verif: async ({ upload, $ }) => {
              await upload({ hostPath: verifiedPath, sandboxPath: "/workspace/design.v" });
              await $`sed -i 's/module[[:space:]]\+verified_/module /g' design.v`;
              if (id === "Arithmetic/Adder/adder_pipe_64bit") {
                await $`sed -i 's/adder_64bit/adder_pipe_64bit/g' design.v`;
              }
              if (id === "Arithmetic/Multiplier/multi_pipe_4bit") {
                await $`sed -i 's/module multi_pipe#/module multi_pipe_4bit#/' design.v`;
              }
              return null;
            },
            expect: { syntaxPass: true, simPass: true },
          },
        ),
      }),
      Task.metric(
        TaskMetric.passAtK(1).pipe(TaskMetric.mapGrade(({ simPass }) => ({ pass: simPass }))),
        {
          name: "Functional pass@1",
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
          name: `Functional pass@${trailCount}`,
          description: `Estimated probability that at least one of ${trailCount} solutions passes simulation.`,
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
          name: `Functional pass power ${trailCount}`,
          description: `Estimated probability that all ${trailCount} solutions pass simulation.`,
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
  const tasks = yield* Tasks.withGithub("hkust-zhiyao/RTLLM", {
    branch: "main",
    commit: rtllmCommit,
  })((repoPath) => Tasks.fromAsyncIter(loadTasks(repoPath)));

  return yield* Bench.make({
    id: "rtllm",
    tasks,
  }).pipe(
    Bench.metric(
      BenchMetric.avgPassAtK(1).pipe(BenchMetric.mapGrade(({ simPass }) => ({ pass: simPass }))),
      {
        name: "Average functional pass at 1",
        description: "Mean functional pass@1 estimate across evaluated RTLLM designs.",
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
        name: `Average functional pass at ${trailCount}`,
        description: `Mean functional pass@${trailCount} estimate across evaluated RTLLM designs.`,
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
        name: `Average functional pass power ${trailCount}`,
        description: `Mean functional pass^${trailCount} estimate across evaluated RTLLM designs.`,
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
  it.effect("loads all RTLLM designs from the pinned dataset layout", () =>
    Effect.gen(function* () {
      const repoPath = path.resolve(current, "../../../.repos/RTLLM");
      const tasks = yield* Tasks.fromAsyncIter(loadTasks(repoPath));
      const taskIds = tasks.map((task) => task.metadata.id);

      assert.lengthOf(tasks, 50);
      assert.strictEqual(new Set(taskIds).size, tasks.length);
      assert.include(taskIds, "Arithmetic/Adder/adder_8bit");
      assert.include(taskIds, "Miscellaneous/Signal generation/square_wave");
      assert.isTrue(tasks.every((task) => task.stages.length === 1));
    }),
  );

  it.effect(
    "evaluates configured RTLLM tasks through the real API and publishes the event stream",
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
                  yield* Ref.update(eventsRef, (currentEvents) => [...currentEvents, event]);
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

        assert.lengthOf(taskResults, testTaskCount);
        assert.deepEqual(Object.keys(result.tasks).sort(), expectedTaskIds);
        assert.isNotEmpty(events);
        assert.strictEqual(events[0]?._tag, "InitEvent");

        for (const event of events) {
          assert.strictEqual(event.bench, bench.metadata.id);
          assert.strictEqual(event.harness, harness.metadata.id);
        }

        const initEvents = events.filter((event) => event._tag === "InitEvent");
        assert.lengthOf(initEvents, 1);
        assert.deepEqual(
          initEvents[0]?.benchMetadata.tasks.map((task) => task.base.id).sort(),
          expectedTaskIds,
        );
        assert.deepEqual(
          events.filter((event) => event._tag === "EvalScheduleEvent").map((event) => event.op),
          ["start", "stop"],
        );

        const stagedEvents = events.filter((event) => event._tag === "TrailStagedEvent");
        const streamEvents = events.filter((event) => event._tag === "TrailStreamEvent");
        const taskMetricEvents = events.filter((event) => event._tag === "TaskMetricEvent");
        const benchMetricEvents = events.filter((event) => event._tag === "BenchMetricEvent");
        const observations: Array<{
          task: string;
          syntaxPass: boolean;
          simPass: boolean;
          inputTokens: number | null;
          outputTokens: number | null;
        }> = [];

        for (const [taskId, taskResult] of Object.entries(result.tasks)) {
          const task = bench.tasks.find((candidate) => candidate.metadata.id === taskId);
          if (task === undefined) {
            return assert.fail(`Missing task definition for ${taskId}`);
          }
          assert.lengthOf(taskResult.trails, testTrailCount);
          assert.isAtMost(
            DateTime.toEpochMillis(taskResult.startedAt),
            DateTime.toEpochMillis(taskResult.finishedAt),
          );
          assert.deepEqual(
            events
              .filter(
                (event): event is Event.TaskScheduleEvent =>
                  event._tag === "TaskScheduleEvent" && event.task === taskId,
              )
              .map((event) => event.op),
            ["start", "stop"],
          );

          const currentTaskMetrics = taskMetricEvents.filter((event) => event.task === taskId);
          assert.deepEqual(
            currentTaskMetrics.map((event) => event.id).sort(),
            task.metrics.map((metric) => metric.metadata.id).sort(),
          );

          for (const [trailIdx, trail] of taskResult.trails.entries()) {
            const grade = yield* Schema.decodeUnknownEffect(template.Grade)(trail.grade);
            assert.isNotEmpty(trail.trajectory.content);
            assert.isAtMost(
              DateTime.toEpochMillis(trail.startedAt),
              DateTime.toEpochMillis(trail.finishedAt),
            );
            assert.deepEqual(
              events
                .filter(
                  (event): event is Event.TrailScheduleEvent =>
                    event._tag === "TrailScheduleEvent" &&
                    event.task === taskId &&
                    event.trailIdx === trailIdx,
                )
                .map((event) => event.op),
              ["start", "stop"],
            );

            const currentStagedEvents = stagedEvents.filter(
              (event) => event.task === taskId && event.trailIdx === trailIdx,
            );
            assert.lengthOf(currentStagedEvents, 1);
            assert.deepEqual(currentStagedEvents[0]?.grade, trail.grade);

            const currentStreamEvents = streamEvents.filter(
              (event) => event.task === taskId && event.trailIdx === trailIdx,
            );
            assert.lengthOf(
              currentStreamEvents.filter((event) => event.part.type === "finish"),
              1,
            );
            observations.push({
              task: taskId,
              syntaxPass: grade.syntaxPass,
              simPass: grade.simPass,
              inputTokens: trail.usage?.inputTokens.total ?? null,
              outputTokens: trail.usage?.outputTokens.total ?? null,
            });
          }
        }

        const completedTrailCount = taskResults.length * testTrailCount;
        const eventCounts = Object.groupBy(events, (event) => event._tag);
        const count = (tag: Event.Event["_tag"]) => eventCounts[tag]?.length ?? 0;
        assert.strictEqual(count("InitEvent"), 1);
        assert.strictEqual(count("EvalScheduleEvent"), 2);
        assert.strictEqual(count("TaskScheduleEvent"), taskResults.length * 2);
        assert.strictEqual(count("TrailScheduleEvent"), completedTrailCount * 2);
        assert.strictEqual(count("TrailStagedEvent"), completedTrailCount);
        assert.strictEqual(count("TaskMetricEvent"), completedTrailCount * 3);
        assert.strictEqual(count("BenchMetricEvent"), completedTrailCount * 3);
        assert.isAtLeast(count("TrailStreamEvent"), completedTrailCount);
        assert.deepEqual(
          [...new Set(benchMetricEvents.map((event) => event.id))].sort(),
          bench.metrics.map((metric) => metric.metadata.id).sort(),
        );

        console.table(observations);
        console.log("Event log:", eventLogPath);
      }),
    1_200_000,
  );
});
