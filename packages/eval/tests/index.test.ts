import { Effect } from "effect";
import { Agent, Benchmark, Exec, Harness, Metric, Prompt, Sandbox, Task } from "@open-insight/eval";

type RandomEvenGrader = Task.Grader<"randomEven", boolean>;
type RandomEvenTask = Task.Task<RandomEvenGrader>;
type RandomEvenGrade = Task.Grade.Result<RandomEvenGrader>;

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

const main = Effect.fn(function* () {
  const task = Task.make<RandomEvenTask>({
    name: "task-1",
    prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: "Write any text." })] })],
    graders: {
      randomEven: async ({ $ }) => {
        const output = await $({ cwd: "/workspace" })`od -An -N4 -tu4 /dev/urandom | tr -d ' '`;
        const value = Number.parseInt(output.trim(), 10);
        return Number.isFinite(value) && value % 2 === 0;
      },
    },
    context: Sandbox.Context.fromDir(import.meta.resolve(".")),
    snapshot: Sandbox.Snapshot.fromContainerfile(`
      FROM docker.io/library/alpine:latest
      WORKDIR /workspace
    `),
  });

  const tasks = yield* Task.fromArray([task]);
  const benchmark = yield* Benchmark.make({
    name: "CustomBenchmark",
    tasks,
  });

  const metricPassAtK = (k: number) => (grades: ReadonlyArray<RandomEvenGrade>) =>
    passAtK({ k, passes: grades.map(({ randomEven }) => randomEven) });

  const metrics = yield* Metric.init<RandomEvenTask>().pipe(
    Metric.withTask("passAt1", metricPassAtK(1)),
    Metric.withTask("passAt2", metricPassAtK(2)),
    Metric.withTask("passAt3", metricPassAtK(3)),
    Metric.withTask("passAt4", metricPassAtK(4)),
    Metric.withTask("passAt5", metricPassAtK(5)),
  );

  const sandbox = yield* Sandbox.Docker.make({ portMappings: [] });
  const agent = yield* Agent.Dummy.make({});

  const harness = yield* Harness.make({
    name: "CustomHarness",
  }).pipe(
    Effect.provideService(Sandbox.ProviderService, sandbox),
    Effect.provideService(Agent.ProviderService, agent),
  );

  const exec = yield* Exec.make({
    benchmark,
    harness,
    metrics,
  }).pipe(Exec.run);
});
