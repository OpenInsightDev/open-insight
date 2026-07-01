import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Agent, Benchmark, Exec, Harness, Metric, Sandbox, Task } from "@open-insight/eval";
import type { EventTransport } from "@/exec/event/index.ts";

type RandomEvenTask = Task.Task<Task.Grader<"randomEven", boolean>>;
type RandomEvenGrade = Task.Grade.Result<Task.Grader<"randomEven", boolean>>;

const trailCount = 8;

const passAtK = ({ k, passes }: { k: number; passes: ReadonlyArray<boolean> }): number => {
  const total = passes.length;
  const correct = passes.filter(Boolean).length;
  const incorrect = total - correct;

  if (k <= 0 || total === 0) {
    return 0;
  }

  if (incorrect < k) {
    return 1;
  }

  let missProbability = 1;
  for (let i = 0; i < k; i++) {
    missProbability *= (incorrect - i) / (total - i);
  }

  return 1 - missProbability;
};

const task = Task.init<RandomEvenTask>({
  name: "random-even",
  description: "Passes when a random number generated inside the sandbox is even.",
}).pipe(
  Task.withTextPrompt("Write any answer."),
  Task.withGrader("randomEven", async ({ cmd }) => {
    const { stdout } = await cmd({
      command: "sh",
      args: ["-c", "od -An -N4 -tu4 /dev/urandom | tr -d ' '"],
      cwd: "/workspace",
    });
    const value = Number.parseInt(stdout.trim(), 10);

    return Number.isFinite(value) && value % 2 === 0;
  }),
  Task.withSnapshot(
    Sandbox.Snapshot.fromContainerfile(`
      FROM docker.io/library/alpine:latest
      WORKDIR /workspace
    `),
  ),
  Task.withContext(Sandbox.Context.Cwd),
  Task.withResources({}),
  Task.build,
);

const benchmark = Benchmark.init<RandomEvenTask>({
  name: "Random Even Docker Eval",
  description: "A minimal Docker-backed integration test for eval.",
}).pipe(Benchmark.withTasks(Task.fromArray([task])), Benchmark.build);

const metricPassAtK = (k: number, grades: ReadonlyArray<RandomEvenGrade>) =>
  passAtK({
    k,
    passes: grades.map(({ randomEven }) => randomEven),
  });

const metrics = Metric.init<RandomEvenTask>().pipe(
  Metric.withTask("pass@1", (grades) => metricPassAtK(1, grades)),
  Metric.withTask("pass@2", (grades) => metricPassAtK(2, grades)),
  Metric.withTask("pass@3", (grades) => metricPassAtK(3, grades)),
  Metric.withTask("pass@4", (grades) => metricPassAtK(4, grades)),
  Metric.withTask("pass@5", (grades) => metricPassAtK(5, grades)),
);

const sandbox = Sandbox.Docker.make({ portMappings: [] });
const agent = Agent.Dummy.make({});
const harness = Harness.init<RandomEvenTask>().pipe(
  Harness.withSandboxProvider(sandbox),
  Harness.withAgentProvider(agent),
  Harness.build,
);

describe("random even docker eval", () => {
  it.live(
    "runs an alpine-backed task with mock transport and pass@1-5 metrics",
    () =>
      Effect.gen(function* () {
        const events: Array<Exec.Event> = [];
        const mockTransport = Effect.succeed({
          send: ({ stream }) =>
            stream.pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              ),
            ),
        } satisfies EventTransport);

        const executor = Exec.init<RandomEvenTask>().pipe(
          Exec.withBenchmark(benchmark),
          Exec.withHarness(harness),
          Exec.withTrailCount(trailCount),
          Exec.withMetrics(metrics),
          Exec.withTransport(mockTransport),
          Exec.build,
        );

        const result = yield* Exec.run(executor, {
          harnessConfig: {},
          sandboxConfig: { cacheSnapshot: true },
        });
        const taskResult = result.tasks["random-even"];

        assert.isDefined(taskResult);
        assert.strictEqual(taskResult?.trails.length, trailCount);
        assert.isTrue(events.some((event) => event._tag === "InitEvent"));
        assert.isTrue(events.some((event) => event._tag === "TaskStreamPartEvent"));

        const passes = taskResult?.trails.map((trail) => trail.grades.randomEven === true) ?? [];

        for (let k = 1; k <= trailCount; k++) {
          const metricName = `pass@${k}`;
          assert.deepStrictEqual(taskResult?.metrics[metricName], [passAtK({ k, passes })]);
        }
      }),
    60_000,
  );
});
