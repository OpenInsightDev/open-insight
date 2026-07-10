import { NodeServices } from "@effect/platform-node";
import { Sandbox } from "@open-insight/core/internal";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { Prompt } from "effect/unstable/ai";
import { fileURLToPath } from "node:url";
import * as Task from "../index.ts";
import { TaskError } from "../error.ts";
import {
  type HarborGrade,
  type HarborMetadata,
  makeGrader,
  makeHarborTask,
  makeVerifier,
} from "./harbor/index.ts";

const fixtureDir = (name: string) =>
  fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

class LoadedHarborTask extends Task.Task<HarborGrade, HarborMetadata> {}

const loadErrorMessage = (error: unknown): string => {
  if (!(error instanceof TaskError)) {
    assert.fail(`Expected TaskError, got ${String(error)}`);
  }
  assert.strictEqual(error.reason._tag, "TaskLoadError");
  return String(error.reason.cause);
};

type ShellOptions = Readonly<{
  cwd?: string;
  env?: Record<string, string>;
}>;

const renderShell = (strings: TemplateStringsArray, values: ReadonlyArray<unknown>): string => {
  let script = strings[0] ?? "";
  for (const [index, value] of values.entries()) {
    script += String(value);
    script += strings[index + 1] ?? "";
  }
  return script;
};

const makeSandbox = ({
  rewardFormat = "json",
  rewardContent = '{"reward":1,"quality":0.75}',
}: {
  rewardFormat?: "json" | "text";
  rewardContent?: string;
} = {}) => {
  const commands: Array<Readonly<{ script: string; options?: ShellOptions }>> = [];
  const uploads: Array<Readonly<{ sandboxPath: string; hostPath: string }>> = [];

  const run = async (
    strings: TemplateStringsArray,
    values: ReadonlyArray<unknown>,
    options?: ShellOptions,
  ): Promise<string> => {
    const script = renderShell(strings, values);
    commands.push({ script, options });
    return script.includes("printf json") ? rewardFormat : "";
  };

  function shell(strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): Promise<string>;
  function shell(
    options: ShellOptions,
  ): (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => Promise<string>;
  function shell(
    first: TemplateStringsArray | ShellOptions,
    ...values: ReadonlyArray<unknown>
  ):
    | Promise<string>
    | ((strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => Promise<string>) {
    if ("raw" in first) {
      return run(first, values);
    }
    return (strings, ...innerValues) => run(strings, innerValues, first);
  }

  const sandbox: Sandbox.SandboxPromise = {
    $: shell,
    cmd: () => Promise.reject(new Error("cmd is unused")),
    readFile: async () => rewardContent,
    writeFile: () => Promise.reject(new Error("writeFile is unused")),
    download: () => Promise.reject(new Error("download is unused")),
    upload: async (upload) => {
      uploads.push(upload);
    },
    expose: () => Promise.reject(new Error("expose is unused")),
  };

  return { commands, sandbox, uploads };
};

describe("makeHarborTask", () => {
  it.effect("loads a single-step Harbor task with directory-based defaults", () =>
    Effect.gen(function* () {
      const task = yield* makeHarborTask(fixtureDir("harbor-task"), LoadedHarborTask);

      assert.instanceOf(task, LoadedHarborTask);
      assert.strictEqual(task.name, "open-insight/harbor-loader");
      assert.strictEqual(task.metadata.description, "Harbor loader fixture");
      assert.deepStrictEqual(task.metadata.authors, [
        "Ada Lovelace <ada@example.com>",
        "Grace Hopper",
      ]);
      assert.deepStrictEqual(task.metadata.keywords, ["harbor", "loader", "pytest"]);
      assert.deepStrictEqual(task.extra, {
        difficulty: "easy",
        category: "programming",
        tags: ["fixture", "single-step"],
      });
      assert.strictEqual(task.prompt.length, 1);
      assert.strictEqual(task.snapshot.image, "ubuntu:24.04");
      assert.strictEqual(task.snapshot.context, `${fixtureDir("harbor-task")}/environment`);
      assert.strictEqual(task.resources.numCPUs, 2);
      assert.strictEqual(task.resources.memoryMiB, 1024);
      assert.strictEqual(task.resources.storageMiB, 4096);
      assert.strictEqual(task.resources.network, false);
      assert.strictEqual(task.resources.buildTimeoutSec, 45);
      assert.strictEqual(task.resources.runTimeoutSec, 90);
      assert.isDefined(task.verifier);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("validates parsed task.toml data with HarborTaskConfig", () =>
    Effect.gen(function* () {
      const exit = yield* makeHarborTask(fixtureDir("harbor-invalid"), LoadedHarborTask).pipe(
        Effect.exit,
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isSuccess(exit)) {
        assert.fail("Expected invalid task.toml to fail");
      }
      assert.include(loadErrorMessage(Cause.squash(exit.cause)), "keywords");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects multi-step Harbor tasks explicitly", () =>
    Effect.gen(function* () {
      const exit = yield* makeHarborTask(fixtureDir("harbor-multi-step"), LoadedHarborTask).pipe(
        Effect.exit,
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isSuccess(exit)) {
        assert.fail("Expected multi-step task to fail");
      }
      assert.include(loadErrorMessage(Cause.squash(exit.cause)), "Multi-step");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("Harbor defaults", () => {
  it("uploads and runs tests, then reads reward.json", async () => {
    const { commands, sandbox, uploads } = makeSandbox();
    const grader = makeGrader("/host/task", { env: { EXPECTED: "loaded" } });

    const result = await grader({ trajectory: Prompt.empty, ...sandbox });

    assert.deepStrictEqual(result, { reward: 1, quality: 0.75 });
    assert.deepStrictEqual(uploads, [{ hostPath: "/host/task/tests", sandboxPath: "/tests" }]);
    assert.include(commands[1]?.script ?? "", "bash /tests/test.sh");
    assert.deepStrictEqual(commands[1]?.options, {
      cwd: "/tests",
      env: { EXPECTED: "loaded" },
    });
  });

  it("loads the scalar reward.txt convention", async () => {
    const { sandbox } = makeSandbox({ rewardFormat: "text", rewardContent: "0.5\n" });

    const result = await makeGrader("/host/task")({ trajectory: Prompt.empty, ...sandbox });

    assert.deepStrictEqual(result, { reward: 0.5 });
  });

  it("rejects an empty reward.txt", async () => {
    const { sandbox } = makeSandbox({ rewardFormat: "text", rewardContent: "\n" });
    let failure: unknown;

    try {
      await makeGrader("/host/task")({ trajectory: Prompt.empty, ...sandbox });
    } catch (cause) {
      failure = cause;
    }

    assert.instanceOf(failure, Error);
    assert.include(failure.message, "reward file is empty");
  });

  it("uploads and runs the reference solution", async () => {
    const { commands, sandbox, uploads } = makeSandbox();
    const verifier = makeVerifier("/host/task", { env: { SOLUTION_MODE: "oracle" } });

    const trajectory = await verifier.exec(sandbox);

    assert.deepStrictEqual(trajectory, Prompt.empty);
    assert.deepStrictEqual(verifier.expect, { reward: 1 });
    assert.deepStrictEqual(uploads, [
      { hostPath: "/host/task/solution", sandboxPath: "/solution" },
    ]);
    assert.include(commands[1]?.script ?? "", "bash /solution/solve.sh");
    assert.deepStrictEqual(commands[1]?.options, {
      cwd: "/solution",
      env: { SOLUTION_MODE: "oracle" },
    });
  });
});
