import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Agent,
  Harness,
  Prompt,
  Response,
  Sandbox,
  Snapshot as CoreSnapshot,
} from "@open-insight/core/internal";
import { Bench, Grade, Task } from "@open-insight/eval";
import { Brand, Effect, Layer, Option, Schema, Stream } from "effect";

export const GradeResult = Schema.Struct({ score: Schema.Number });
export const template = CoreSnapshot.Alpine;
export const snapshot = Brand.nominal<CoreSnapshot.Snapshot>()({
  name: "open-insight/eval-stream-test",
});

export const responseParts = (text: string): ReadonlyArray<Response.StreamPartEncoded> => [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: text },
  { type: "text-end", id: "text" },
  {
    type: "finish",
    reason: "stop",
    usage: {
      inputTokens: { total: 3 },
      outputTokens: { total: 5 },
    },
  },
];

export type FixturePrompt = Readonly<{
  sessionIndex: number;
  promptIndex: number;
  prompt: Prompt.Prompt;
}>;

export type FixtureState = {
  sessions: number;
  prompts: Array<FixturePrompt>;
};

export type FixtureOptions = Readonly<{
  harnessId?: string;
  respond?: (prompt: FixturePrompt) => Stream.Stream<Response.StreamPartEncoded, Agent.AgentError>;
}>;

const sandbox: Sandbox.Sandbox = {
  spawn: () => Effect.die("sandbox spawn is not used by the stream fixture"),
  exitCode: () => Effect.die("sandbox exitCode is not used by the stream fixture"),
  success: () => Effect.die("sandbox success is not used by the stream fixture"),
  stdout: () => Effect.die("sandbox stdout is not used by the stream fixture"),
  stderr: () => Effect.die("sandbox stderr is not used by the stream fixture"),
  readFile: () => Effect.die("sandbox readFile is not used by the stream fixture"),
  writeFile: () => Effect.die("sandbox writeFile is not used by the stream fixture"),
  download: () => Effect.die("sandbox download is not used by the stream fixture"),
  upload: () => Effect.die("sandbox upload is not used by the stream fixture"),
  expose: () => Effect.die("sandbox expose is not used by the stream fixture"),
};

export const makeRuntime = (options: FixtureOptions = {}) => {
  const state: FixtureState = { sessions: 0, prompts: [] };

  const sandboxProvider: Sandbox.Provider = {
    acquireSnapshot: () => Effect.succeed(snapshot),
    deriveSnapshot: () => Effect.succeed(snapshot),
    runSandbox: () => Effect.succeed(sandbox),
  };

  const agentLayer = Agent.layerFrom({
    snapshotExtension: Option.none(),
    runSession: () =>
      Effect.sync(() => {
        const sessionIndex = state.sessions++;
        let promptIndex = 0;

        return {
          prompt: (prompt: Prompt.Prompt) => {
            const fixturePrompt = { sessionIndex, promptIndex, prompt };
            promptIndex += 1;
            state.prompts.push(fixturePrompt);
            return (
              options.respond?.(fixturePrompt) ??
              Stream.fromIterable(
                responseParts(`answer-${sessionIndex}-${fixturePrompt.promptIndex}`),
              )
            );
          },
        };
      }),
  });

  const providers = Layer.mergeAll(
    Layer.succeed(Sandbox.ProviderService)(sandboxProvider),
    agentLayer,
  );
  const runtime = Layer.mergeAll(
    Harness.Service.layer(options.harnessId ?? "stream-test-harness").pipe(
      Layer.provide(providers),
    ),
    providers,
    NodeServices.layer,
  );

  return { runtime, state, sandbox };
};

export type BenchOptions = Readonly<{
  benchId?: string;
  taskIds?: ReadonlyArray<string>;
  prompt?: Prompt.Gen.Options;
  grade?: () => PromiseLike<{ score: number }>;
  metrics?: ReadonlyArray<import("@open-insight/eval").Metric.Task.Metric>;
  trajMetrics?: ReadonlyArray<import("@open-insight/eval").Metric.Traj.Metric>;
  schedMetrics?: ReadonlyArray<import("@open-insight/eval").Metric.Sched.Metric>;
  benchMetrics?: ReadonlyArray<import("@open-insight/eval").Metric.Bench.Metric>;
}>;

export const makeBench = Effect.fn(function* (options: BenchOptions = {}) {
  const grade = options.grade ?? (async () => ({ score: 1 }));
  const tasks = yield* Effect.all(
    (options.taskIds ?? ["task-1"]).map((id) =>
      Task.make(GradeResult)({
        id,
        snapshot: template,
        prompt: options.prompt ?? { init: "solve" },
        grader: Grade.embed(grade),
        metrics: options.metrics,
        trajMetrics: options.trajMetrics,
        schedMetrics: options.schedMetrics,
      }),
    ),
  );

  return yield* Bench.make(options.benchId ?? "stream-test-bench", Effect.succeed(tasks), {
    metrics: options.benchMetrics,
  });
});
