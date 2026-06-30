import {
  Agent,
  Benchmark,
  Effect,
  Exec,
  Harness,
  Metric,
  Prompt,
  Sandbox,
  Task,
} from "@open-insight/eval";
import { Chat } from "effect/unstable/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Config } from "effect";
import { NodeServices } from "@effect/platform-node";

type CustomTask = Task.Task<Task.Grader<"string", string> | Task.Grader<"boolean", boolean>>;

const task = Task.init<CustomTask>({
  name: "Custom Task",
  description: "A custom task for testing purposes",
}).pipe(
  Task.withTextPrompt("This is a custom task prompt."),
  Task.withGrader("string", async ({ $ }) => "string"),
  Task.withGrader("boolean", async ({ $ }) => false),
  Task.withSnapshot(Sandbox.Snapshot.fromImage("docker.io/library/alpine:latest")),
  Task.withContext(Sandbox.Context.Script),
  Task.build,
);

const benchmark = Benchmark.init<CustomTask>({
  name: "Custom Benchmark",
  description: "A benchmark for testing the Task module",
}).pipe(Benchmark.withTasks(Task.fromArray<CustomTask>([])), Benchmark.build);

const metrics = Metric.init<CustomTask>().pipe(
  Metric.withTrajReduce("trajReduce", 0, (prev, { trajectory, messages }) => {
    return trajectory.content.length + prev;
  }),
  Metric.withTrajEach("trajEach", ({ trajectory }) => {
    return trajectory.content.length;
  }),
  Metric.withTraj("trajAll", ({ trajectory }) => {
    return trajectory.content.length;
  }),
  Metric.withTaskReduce("taskReduce", 0, (prev, { string, boolean }) => 1),
  Metric.withTaskEach("taskEach", ({ string, boolean }) => 1),
  Metric.withTask("taskAll", (grades) => 1),
  Metric.withBenchReduce(
    "benchReduce",
    0,
    (prev, { task, input: { taskReduce, taskEach, taskAll } }) => {
      return taskReduce + taskEach + taskAll;
    },
  ),
  Metric.withBenchEach("benchEach", ({ task, input: { taskReduce, taskEach, taskAll } }) => {
    return taskReduce + taskEach + taskAll;
  }),
  Metric.withBenchmark("benchAll", (inputs) => {
    return Object.values(inputs).reduce((sum, input) => {
      return sum + input.taskReduce + input.taskEach + input.taskAll;
    }, 0);
  }),
);

const OpenAi = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
});
const GPT = OpenAiLanguageModel.model("gpt-5.4");
const agent = Agent.Effect.make({ chat: Chat.empty }).pipe(
  Effect.provide(GPT),
  Effect.provide(OpenAi),
);

const sandbox = Sandbox.Docker.make({
  portMappings: [{ sandboxPort: 80, hostPort: 8080 }],
});

const harness = Harness.init<CustomTask>().pipe(
  Harness.withSandboxProvider(sandbox),
  Harness.withAgentProvider(agent),
  Harness.build,
);

const harnessMetrics = metrics.pipe(
  Metric.withTrajEach("harnessTrajectory", ({ trajectory }) => {
    return trajectory.content.length;
  }),
);

const executor = Exec.init<CustomTask>().pipe(
  Exec.withBenchmark(benchmark),
  Exec.withHarness(harness),
  Exec.withMetrics(harnessMetrics),
  Exec.build,
  Effect.provide(NodeServices.layer),
);

const result = await Exec.runPromise(executor, {
  sandboxConfig: { cacheSnapshot: false },
});
