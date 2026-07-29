import { Crypto, Effect, FileSystem, Path, Scope } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import { Error as TasksError } from "#/tasks/error.ts";
import type { StepConfig, TaskConfig } from "./config.ts";
import { GradeResult, wrapGrader } from "./reward.ts";
import { makeGrader, makeInit, makeVerifier } from "./runtime.ts";
import type { HarborTask } from "./types.ts";

type StageSpec = Readonly<{
  name: string;
  instruction: string;
  grader: Grade.Exec<GradeResult, Grade.Results>;
  verification?: Grade.VerifOptions<GradeResult>;
  init: Task.Init | null;
}>;

type TaskBuilder<T extends Task.Template.Any = Task.Template.Any> = Effect.Effect<
  Task.Builder<GradeResult, HarborTask["extras"], Grade.Results, T>,
  Task.Error,
  Crypto.Crypto | Scope.Scope
>;

const invalid = (message: string) => TasksError.invalid(new Error(message));

const readPrompt = Effect.fn(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.mapError(TasksError.source)))) {
    return yield* Effect.fail(invalid(`Harbor instruction file does not exist: ${file}`));
  }
  return yield* fs.readFileString(file).pipe(Effect.mapError(TasksError.source));
});

const findDir = Effect.fn(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(dir).pipe(Effect.mapError(TasksError.source))) ? dir : undefined;
});

const requireFile = Effect.fn(function* (file: string, label: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.mapError(TasksError.source)))) {
    return yield* Effect.fail(invalid(`${label} does not exist: ${file}`));
  }
});

const verifierEnv = (config: TaskConfig, step: StepConfig | undefined) => ({
  ...config.verifier?.env,
  ...step?.verifier?.env,
});

export const makeStages = Effect.fn(function* (
  taskDir: string,
  config: TaskConfig,
): Effect.fn.Return<ReadonlyArray<StageSpec>, TasksError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workdir = config.environment?.workdir;
  const rootTestsDir = yield* findDir(path.join(taskDir, "tests"));
  const rootSolutionDir = yield* findDir(path.join(taskDir, "solution"));
  const steps = config.steps ?? [];

  if (steps.length === 0) {
    if (rootTestsDir === undefined) {
      return yield* Effect.fail(invalid(`Harbor tests directory does not exist: ${taskDir}/tests`));
    }
    yield* requireFile(path.join(rootTestsDir, "test.sh"), "Harbor verifier script");
    if (rootSolutionDir !== undefined) {
      yield* requireFile(path.join(rootSolutionDir, "solve.sh"), "Harbor solution script");
    }
    const grader = makeGrader({
      testDirs: [rootTestsDir],
      workdir,
      env: config.verifier?.env,
    });
    return [
      {
        name: "main",
        instruction: yield* readPrompt(path.join(taskDir, "instruction.md")),
        grader,
        verification:
          rootSolutionDir === undefined
            ? undefined
            : {
                verif: makeVerifier({
                  solutionDir: rootSolutionDir,
                  workdir,
                  env: config.solution?.env,
                }),
                expect: { reward: 1 },
              },
        init: makeInit({
          workdir,
          setup: false,
          environmentHealthcheck: config.environment?.healthcheck,
        }),
      },
    ];
  }

  const names = new Set<string>();
  const specs: Array<StageSpec> = [];
  for (const [index, step] of steps.entries()) {
    if (names.has(step.name)) {
      return yield* Effect.fail(invalid(`Duplicate Harbor step name: ${step.name}`));
    }
    names.add(step.name);
    if (path.basename(step.name) !== step.name || step.name === "." || step.name === "..") {
      return yield* Effect.fail(invalid(`Invalid Harbor step name: ${step.name}`));
    }

    const stepDir = path.join(taskDir, "steps", step.name);
    const stepTestsDir = yield* findDir(path.join(stepDir, "tests"));
    const testDirs = [rootTestsDir, stepTestsDir].filter((dir): dir is string => dir !== undefined);
    if (testDirs.length === 0) {
      return yield* Effect.fail(
        invalid(`Harbor step ${JSON.stringify(step.name)} has no tests directory`),
      );
    }
    const stepTestExists =
      stepTestsDir !== undefined &&
      (yield* fs
        .exists(path.join(stepTestsDir, "test.sh"))
        .pipe(Effect.mapError(TasksError.source)));
    const rootTestExists =
      rootTestsDir !== undefined &&
      (yield* fs
        .exists(path.join(rootTestsDir, "test.sh"))
        .pipe(Effect.mapError(TasksError.source)));
    if (!stepTestExists && !rootTestExists) {
      return yield* Effect.fail(
        invalid(`Harbor step ${JSON.stringify(step.name)} has no verifier script`),
      );
    }

    const stepSolutionDir = yield* findDir(path.join(stepDir, "solution"));
    const solutionDir = stepSolutionDir ?? rootSolutionDir;
    if (solutionDir !== undefined) {
      yield* requireFile(path.join(solutionDir, "solve.sh"), "Harbor solution script");
    }
    const workdirDir = yield* findDir(path.join(stepDir, "workdir"));
    const setup =
      workdirDir !== undefined &&
      (yield* fs
        .exists(path.join(workdirDir, "setup.sh"))
        .pipe(Effect.mapError(TasksError.source)));
    const grader = wrapGrader(
      makeGrader({ testDirs, workdir, env: verifierEnv(config, step) }),
      config.multi_step_reward_strategy ?? "mean",
      index === steps.length - 1,
    );
    specs.push({
      name: step.name,
      instruction: yield* readPrompt(path.join(stepDir, "instruction.md")),
      grader,
      verification:
        solutionDir === undefined
          ? undefined
          : {
              verif: makeVerifier({
                solutionDir,
                workdir,
                env: config.solution?.env,
              }),
              expect: { reward: 1 },
            },
      init: makeInit({
        workdir,
        workdirDir,
        setup,
        environmentHealthcheck: index === 0 ? config.environment?.healthcheck : undefined,
        stepHealthcheck: step.healthcheck,
      }),
    });
  }
  return specs;
});

export const addStages =
  (stages: ReadonlyArray<StageSpec>) =>
  <T extends Task.Template.Any>(base: TaskBuilder<T>): TaskBuilder<T> => {
    let task = base;
    for (const stage of stages) {
      const common = {
        schema: GradeResult,
        prompt: stage.instruction,
        grader: stage.grader,
        init: stage.init,
        resume: true,
      };
      task =
        stage.verification === undefined
          ? task.pipe(Task.stage(stage.name, common))
          : task.pipe(
              Task.stage(stage.name, {
                ...common,
                verif: stage.verification.verif,
                expect: stage.verification.expect,
              }),
            );
    }
    return task;
  };
