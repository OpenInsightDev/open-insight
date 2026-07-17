import { Sandbox, Snapshot } from "@open-insight/core/internal";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Prompt } from "effect/unstable/ai";
import type * as Grade from "#/grade/index.ts";
import { Task, type Options } from "#/task/build.ts";
import type { Verifier } from "#/task/verif.ts";
import { Error as TasksError } from "../error.ts";
import { type EnvConfig, type Metadata, type TaskConfig, readTaskConfig } from "./config.ts";

export * from "./config.ts";

export const GradeResult = Schema.Record(Schema.String, Schema.Finite);
export type GradeResult = Schema.Schema.Type<typeof GradeResult>;
export type HarborTask = Task<GradeResult, Metadata>;

export type TaskClass<T extends HarborTask = HarborTask> = new (
  options: Options<GradeResult, Metadata>,
) => T;

const rewardTextPath = "/logs/verifier/reward.txt";
const rewardJsonPath = "/logs/verifier/reward.json";

const decodeJsonReward = async (content: string): Promise<GradeResult> => {
  const parsed: unknown = JSON.parse(content);
  return Schema.decodeUnknownPromise(GradeResult)(parsed);
};

const decodeTextReward = async (content: string): Promise<GradeResult> => {
  const value = content.trim();
  if (value.length === 0) {
    throw new Error(`Harbor reward file is empty: ${rewardTextPath}`);
  }
  const reward = Number(value);
  return Schema.decodeUnknownPromise(GradeResult)({ reward });
};

export const makeGrader =
  (
    taskDir: string,
    { env = {} }: { readonly env?: Record<string, string> } = {},
  ): Grade.Grader<GradeResult> =>
  async ({ $, readFile, upload }) => {
    await $`rm -rf /tests /logs/verifier && mkdir -p /logs/verifier`;
    await upload({ hostPath: `${taskDir}/tests`, sandboxPath: "/tests" });
    await $({ cwd: "/tests", env })`bash /tests/test.sh`;

    const rewardFormat = (
      await $`if [ -f ${rewardJsonPath} ]; then printf json; elif [ -f ${rewardTextPath} ]; then printf text; else exit 1; fi`
    ).trim();

    if (rewardFormat === "json") {
      return decodeJsonReward(await readFile({ sandboxPath: rewardJsonPath }));
    }
    if (rewardFormat === "text") {
      return decodeTextReward(await readFile({ sandboxPath: rewardTextPath }));
    }
    throw new Error(`Unsupported Harbor reward format: ${rewardFormat}`);
  };

export const makeVerifier = (
  taskDir: string,
  { env = {} }: { readonly env?: Record<string, string> } = {},
): Verifier<GradeResult> => ({
  exec: async ({ $, upload }) => {
    await $`rm -rf /solution`;
    await upload({ hostPath: `${taskDir}/solution`, sandboxPath: "/solution" });
    await $({ cwd: "/solution", env })`bash /solution/solve.sh`;
    return Prompt.empty;
  },
  expect: { reward: 1 },
});

export const makeSnapshot = Effect.fn("Task.Load.makeSnapshot")(function* (
  taskDir: string,
  environment?: EnvConfig,
) {
  const path = yield* Path.Path;
  const envDir = path.resolve(taskDir, "environment");

  if (environment?.docker_image !== undefined) {
    return Snapshot.make({ image: environment.docker_image, context: envDir });
  }

  return yield* Snapshot.fromContainerfile({
    filePath: path.resolve(envDir, "Dockerfile"),
    context: envDir,
  });
});

const makeResources = (config: TaskConfig): Sandbox.Resources => {
  const environment = config.environment;
  const agentTimeout = config.agent?.timeout_sec ?? 600;
  const verifierTimeout = config.verifier?.timeout_sec ?? 600;
  const networkMode = environment?.network_mode ?? "public";

  return Sandbox.Resources.make({
    numCPUs: environment?.cpus ?? 1,
    numGPUs: environment?.gpus ?? 0,
    memoryMiB: environment?.memory_mb ?? 2048,
    storageMiB: environment?.storage_mb ?? 10240,
    network: networkMode !== "no-network",
    buildTimeoutSec: Math.ceil(environment?.build_timeout_sec ?? 600),
    runTimeoutSec: Math.ceil(Math.max(agentTimeout, verifierTimeout)),
  });
};

const formatAuthor = ({
  name,
  email,
}: {
  readonly name: string;
  readonly email?: string;
}): string => (email === undefined ? name : `${name} <${email}>`);

export const makeTask = Effect.fn("Task.Load.makeTask")(function* <T extends HarborTask>(
  taskDir: string,
  TaskClass: TaskClass<T>,
): Effect.fn.Return<T, TasksError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedTaskDir = path.resolve(taskDir);
  const config = yield* readTaskConfig(resolvedTaskDir);

  if (config.steps !== undefined && config.steps.length > 0) {
    return yield* Effect.fail(
      TasksError.unsupported(new Error("Multi-step Harbor tasks are not supported")),
    );
  }
  if (config.environment?.os === "windows") {
    return yield* Effect.fail(
      TasksError.unsupported(new Error("Windows Harbor tasks are not supported")),
    );
  }

  const instruction = yield* fs
    .readFileString(path.join(resolvedTaskDir, "instruction.md"))
    .pipe(Effect.mapError(TasksError.source));
  const snapshot = yield* makeSnapshot(resolvedTaskDir, config.environment).pipe(
    Effect.mapError(TasksError.init),
  );
  const hasSolution = yield* fs
    .exists(path.join(resolvedTaskDir, "solution", "solve.sh"))
    .pipe(Effect.mapError(TasksError.source));
  const packageInfo = config.task;

  return yield* Effect.try({
    try: () =>
      new TaskClass({
        name: packageInfo?.name ?? path.basename(resolvedTaskDir),
        description: packageInfo?.description,
        keywords: packageInfo?.keywords,
        authors: packageInfo?.authors?.map(formatAuthor),
        prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: instruction })] })],
        grader: makeGrader(resolvedTaskDir, { env: config.verifier?.env }),
        verifier: hasSolution
          ? makeVerifier(resolvedTaskDir, { env: config.solution?.env })
          : undefined,
        snapshot,
        resources: makeResources(config),
        extra: config.metadata ?? {},
      }),
    catch: TasksError.init,
  });
});
