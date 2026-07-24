import { Effect, FileSystem, Logger, pipe, References } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { Agent, Bench, Eval, Harness, Metric, Sandbox, Snapshot, Task } from "@open-insight/eval";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { LanguageModel, Prompt } from "effect/unstable/ai";
import { NodeHttpClient } from "@effect/platform-node";
import * as fs from "fs/promises";
import * as path from "node:path";
import { assert, it } from "@effect/vitest";

const descFile = "design_description.txt";
const tbFile = "testbench.v";
const refPrefix = "verified_";
const refSuffix = ".v";
const debugLogPath = path.join(import.meta.dirname, ".logs", "rtllm.debug.log");

const passed = (output: string): boolean => /Your Design Passed/.test(output);

const renameRef = (source: string, moduleName: string): string =>
  source.replace(/\bmodule\s+verified_[A-Za-z_][A-Za-z0-9_$]*/, `module ${moduleName}`);

const findTasks = async (dir: string): Promise<ReadonlyArray<string>> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const childDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== ".git")
    .map((entry) => path.join(dir, entry.name));

  const nested = await Promise.all(childDirs.map((childDir) => findTasks(childDir)));
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const current = files.includes(descFile) && files.includes(tbFile) ? [dir] : [];

  return [...current, ...nested.flat()].sort();
};

class RtllmTask extends Task.Task<{ simPass: boolean }, { category: string; suite: string }> {}

async function* load(repoPath: string): AsyncIterable<RtllmTask> {
  const snapshot = Snapshot.parseContainerfile(
    `FROM ubuntu:latest
     RUN apt-get update && apt-get install -y iverilog && rm -rf /var/lib/apt/lists/*`,
  );

  for (const taskDir of await findTasks(repoPath)) {
    const relativeDir = path.relative(repoPath, taskDir).split(path.sep).join("/");
    const [category, suite = category] = relativeDir.split("/");
    const prompt = await fs.readFile(path.join(taskDir, descFile), "utf8");
    const moduleName = path.basename(taskDir);

    const refs = (await fs.readdir(taskDir))
      .filter((file) => file.startsWith(refPrefix) && file.endsWith(refSuffix))
      .sort();
    const refFile = refs[0];
    if (refFile === undefined || refs.length !== 1) {
      throw new Error(`Expected exactly one verified_*.v file in ${taskDir}`);
    }

    const ref = await fs.readFile(path.join(taskDir, refFile), "utf8");

    yield new RtllmTask({
      name: relativeDir,
      prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: prompt })] })],
      grader: async ({ upload, $ }) => {
        await $`rm -rf /tmp/rtllm`;
        await upload({
          hostPath: taskDir,
          sandboxPath: "/tmp/rtllm",
        });

        const output = await $`cp top.v /tmp/rtllm/top.v && \
          cd /tmp/rtllm && \
          timeout 30s iverilog -g2012 -o simv top.v testbench.v && \
          timeout 30s vvp simv`;
        return { simPass: passed(output) };
      },
      verifier: {
        exec: async ({ writeFile }) => {
          await writeFile({
            sandboxPath: "top.v",
            content: renameRef(ref, moduleName),
          });
          return Prompt.empty;
        },
        expect: { simPass: true },
      },
      snapshot,
      extra: {
        category,
        suite,
      },
    });
  }
}

const run = Effect.fn("run")(function* () {
  const repoPath = path.resolve("./.repos/RTLLM");
  const tasks = yield* Task.fromAsyncIter(load(repoPath));

  const benchmark = yield* Bench.make({
    name: "rtllm",
    tasks,
  }).pipe(Bench.head(4));

  const metrics = Metric.init<RtllmTask>().pipe(
    Metric.withTaskAll("passAt1", (grades) =>
      pipe(
        grades.map(({ simPass }) => simPass),
        Metric.passAtK(1),
      ),
    ),
    Metric.withTaskAll("passAt3", (grades) =>
      pipe(
        grades.map(({ simPass }) => simPass),
        Metric.passAtK(3),
      ),
    ),
    Metric.withBenchAll("avgPassAt1", (tasks) =>
      pipe(
        Object.values(tasks).map(({ passAt1 }) => passAt1),
        Metric.mean,
      ),
    ),
    Metric.withBenchAll("avgPassAt3", (tasks) =>
      pipe(
        Object.values(tasks).map(({ passAt3 }) => passAt3),
        Metric.mean,
      ),
    ),
  );

  const client = yield* OpenAiClient.make({}).pipe(Effect.provide(NodeHttpClient.layerUndici));

  const model = yield* OpenAiLanguageModel.make({
    model: "deepseek-v4-flash",
  }).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));

  const agent = yield* Agent.Effect.make({}).pipe(
    Effect.provideService(LanguageModel.LanguageModel, model),
  );

  const sandbox = yield* Sandbox.Docker.make({});

  const harness = yield* Harness.make({
    id: "rtllm",
  }).pipe(
    Effect.provideService(Agent.ProviderService, agent),
    Effect.provideService(Sandbox.ProviderService, sandbox),
  );

  const harnessMetrics = yield* metrics;

  const evalRun = yield* Eval.make<RtllmTask>({
    benchmark,
    harness,
    metrics: harnessMetrics,
    trailCount: 3,
  });

  const result = yield* Eval.run(evalRun, {
    verifMode: true,
    trailConcurrency: 16,
  });
  return result;
});

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(path.dirname(debugLogPath), { recursive: true });

  const fileLogger = yield* Logger.formatLogFmt.pipe(Logger.toFile(debugLogPath));
  const result = yield* Effect.logInfo(`[rtllm] writing debug logs to ${debugLogPath}`).pipe(
    Effect.andThen(run()),
    Effect.tap((result) => Effect.logInfo("[rtllm] benchmark result", JSON.stringify(result))),
    Effect.onError((cause) => Effect.logError("[rtllm] benchmark failed", cause)),
    Effect.provide(Logger.layer([fileLogger], { mergeWithExisting: true })),
    Effect.provideService(References.MinimumLogLevel, "Debug"),
  );

  return result;
})
  .pipe(Effect.scoped)
  .pipe(Effect.provide(DevTools.layer()));

it("rtllm benchmark should pass", async () => {
  const result = await Eval.runPromise(main);
  assert.isTrue(result !== null);
}, 100000);
