import { Crypto, Effect, FileSystem, Path } from "effect";
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
  grader: Grade.Definition<GradeResult, Grade.Results>;
  init: Task.Init | null;
}>;

type HarborTemplate = Task.Template.Template<
  typeof GradeResult,
  Task.Template.ExtrasSchema<HarborTask["extras"]>
>;

type TaskBuilder<
  G extends Grade.Result,
  S extends Grade.Results,
  T extends HarborTemplate,
  E,
  R,
> = Effect.Effect<Task.Builder<G, HarborTask["extras"], S, T>, E, R>;

type BuiltTask<T extends HarborTemplate, E, R> = Effect.Effect<
  Task.Task<Task.Template.GradeResult<T>, HarborTask["extras"], T>,
  E | Task.Error,
  R | Crypto.Crypto
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
    const grade = makeGrader({
      testDirs: [rootTestsDir],
      workdir,
      env: config.verifier?.env,
    });
    return [
      {
        name: "main",
        instruction: yield* readPrompt(path.join(taskDir, "instruction.md")),
        grader: Grade.make(
          grade,
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
        ),
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
    const grade = wrapGrader(
      makeGrader({ testDirs, workdir, env: verifierEnv(config, step) }),
      config.multi_step_reward_strategy ?? "mean",
      index === steps.length - 1,
    );
    specs.push({
      name: step.name,
      instruction: yield* readPrompt(path.join(stepDir, "instruction.md")),
      grader: Grade.make(
        grade,
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
      ),
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
  <G extends Grade.Result, S extends Grade.Results, T extends HarborTemplate, E, R>(
    base: TaskBuilder<G, S, T, E, R>,
  ): BuiltTask<T, E, R> => {
    const [current, ...remaining] = stages;
    if (current === undefined) {
      return Effect.fail(Task.Error.metadata(new Error("A Harbor task must have a stage")));
    }

    const common = {
      prompt: current.instruction,
      grader: current.grader,
      init: current.init,
      resume: true,
    };
    if (remaining.length === 0) {
      return base.pipe(Task.endStage(current.name, common));
    }
    return base.pipe(Task.stage(GradeResult)(current.name, common), addStages(remaining));
  };
