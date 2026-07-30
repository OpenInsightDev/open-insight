import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Agent, Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import { DateTime, Effect, Option, Schema, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import * as Event from "#/event/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import * as Config from "./config.ts";
import { createTrail } from "./trail.ts";

const passedTemplate = Task.Template.make({
  Grade: {
    passed: Schema.Boolean,
  },
});

const initializedTemplate = Task.Template.make({
  Grade: {
    initialized: Schema.Boolean,
  },
});

const makeSandbox = (files: Map<string, string>): Sandbox.Sandbox => {
  const handle = { exitCode: ExitCode(0), stdout: "", stderr: "" };

  return {
    spawn: () => Effect.succeed(handle),
    exitCode: () => Effect.succeed(ExitCode(0)),
    success: () => Effect.void,
    stdout: () => Effect.succeed(""),
    stderr: () => Effect.succeed(""),
    cmd: () => Effect.succeed(handle),
    readFile: ({ sandboxPath }) => Effect.succeed(files.get(sandboxPath) ?? ""),
    writeFile: ({ sandboxPath, content }) =>
      Effect.sync(() => {
        files.set(sandboxPath, content);
      }),
    download: () => Effect.void,
    upload: () => Effect.void,
    expose: () => Effect.succeed({ hostUrl: "http://localhost" }),
  };
};

const finishPart = Response.makePart("finish", {
  reason: "stop",
  usage: Schema.decodeSync(Response.Usage)({
    inputTokens: {
      uncached: 0,
      total: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 0,
      text: 0,
      reasoning: 0,
    },
  }),
  response: undefined,
});

const makeRunTrail = Effect.fn(function* ({ initiallySolved }: { initiallySolved: boolean }) {
  const solutionPath = "/workspace/solution.txt";
  const files = new Map<string, string>();
  if (initiallySolved) {
    files.set(solutionPath, "solved");
  }

  const grades: boolean[] = [];
  let verifierRuns = 0;
  const grader: Grade.Exec<typeof passedTemplate.Grade.Type, Grade.Results> = async ({
    readFile,
  }) => {
    const solved = (await readFile({ sandboxPath: solutionPath })) === "solved";
    grades.push(solved);
    return { passed: solved };
  };
  const verifier: Grade.Verifier = async ({ writeFile }) => {
    verifierRuns += 1;
    await writeFile({ sandboxPath: solutionPath, content: "solved" });
    return null;
  };

  const snapshot = Snapshot.make("test-image");
  const handle = yield* Snapshot.Handle.make(snapshot);
  const task = yield* Task.make(passedTemplate)({
    id: "test-task",
    name: "Test task",
    snapshot,
  }).pipe(
    Task.endStage("solve", {
      id: "solve",
      prompt: "Solve the task",
      grader: Grade.make(grader, {
        verif: verifier,
        expect: { passed: true },
      }),
    }),
  );
  const sandboxProvider = {
    aquireSnapshot: () => Effect.succeed(handle),
    deriveSnapshot: () => Effect.die("verif mode must not derive an agent snapshot"),
    runSandbox: () => Effect.succeed(makeSandbox(files)),
  } satisfies Sandbox.Provider;
  const agentProvider = {
    snapshotExtension: Option.none(),
    runSession: () => Effect.die("verif mode must not run the configured agent"),
  } satisfies Agent.Provider;
  const eventQueue = yield* Event.makeQueue();

  const runTrail = yield* createTrail({
    task,
    bench: "test-bench",
    harness: "test-harness",
    config: Config.make({ verifMode: true }),
    eventQueue,
  }).pipe(
    Effect.provideService(Agent.ProviderService, agentProvider),
    Effect.provideService(Sandbox.ProviderService, sandboxProvider),
  );

  return { runTrail, grades, verifierRuns: () => verifierRuns };
});

describe("verification trail", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("initializes the stage before starting the agent", () =>
      Effect.gen(function* () {
        const initializedPath = "/workspace/initialized.txt";
        const files = new Map<string, string>();
        const calls: Array<string> = [];
        let promptCalls = 0;
        const snapshot = Snapshot.make("test-image");
        const handle = yield* Snapshot.Handle.make(snapshot);
        const task = yield* Task.make(initializedTemplate)({
          id: "test-task",
          name: "Test task",
          snapshot,
        }).pipe(
          Task.endStage("solve", {
            id: "solve",
            prompt: async (context) => {
              calls.push("prompt");
              promptCalls += 1;
              assert.strictEqual(await context.readFile({ sandboxPath: initializedPath }), "ready");
              assert.isFalse("writeFile" in context);
              assert.isFalse("upload" in context);
              assert.isFalse("expose" in context);
              return promptCalls === 1 ? "Solve the task" : null;
            },
            init: async ({ writeFile }) => {
              calls.push("init");
              await writeFile({ sandboxPath: initializedPath, content: "ready" });
            },
            grader: Grade.make(async ({ readFile }) => {
              calls.push("grader");
              return {
                initialized: (await readFile({ sandboxPath: initializedPath })) === "ready",
              };
            }),
          }),
        );
        const sandboxProvider = {
          aquireSnapshot: () => Effect.succeed(handle),
          deriveSnapshot: () => Effect.die("agent snapshot derivation is not expected"),
          runSandbox: () => Effect.succeed(makeSandbox(files)),
        } satisfies Sandbox.Provider;
        const agentProvider = {
          snapshotExtension: Option.none(),
          runSession: () =>
            Effect.sync(() => {
              assert.strictEqual(files.get(initializedPath), "ready");
              calls.push("agent");
              return {
                trajectory: () => Effect.succeed(Prompt.make("completed")),
                prompt: () => Stream.make(finishPart),
              } satisfies Agent.Agent;
            }),
        } satisfies Agent.Provider;
        const eventQueue = yield* Event.makeQueue();
        const runTrail = yield* createTrail({
          task,
          bench: "test-bench",
          harness: "test-harness",
          config: Config.make(),
          eventQueue,
        }).pipe(
          Effect.provideService(Agent.ProviderService, agentProvider),
          Effect.provideService(Sandbox.ProviderService, sandboxProvider),
        );

        const result = yield* runTrail(0);
        const grade = yield* Schema.decodeUnknownEffect(initializedTemplate.Grade)(result.grade);

        assert.deepStrictEqual(calls, ["init", "agent", "prompt", "prompt", "grader"]);
        assert.isTrue(grade.initialized);
        assert.isTrue(DateTime.isLessThanOrEqualTo(result.startedAt, result.finishedAt));
      }),
    );

    it.effect("grades the untouched sandbox before running the verifier", () =>
      Effect.gen(function* () {
        const { runTrail, grades, verifierRuns } = yield* makeRunTrail({ initiallySolved: false });
        const result = yield* runTrail(0);
        const grade = yield* Schema.decodeUnknownEffect(passedTemplate.Grade)(result.grade);

        assert.deepStrictEqual(grades, [false, true]);
        assert.isAbove(verifierRuns(), 0);
        assert.isTrue(grade.passed);
      }),
    );

    it.effect("fails before the verifier when the untouched sandbox already matches expect", () =>
      Effect.gen(function* () {
        const { runTrail, grades, verifierRuns } = yield* makeRunTrail({ initiallySolved: true });
        const error = yield* Effect.flip(runTrail(0));

        assert.deepStrictEqual(grades, [true]);
        assert.strictEqual(verifierRuns(), 0);
        if (error.reason._tag !== "VerifInitialMatch") {
          return yield* Effect.die(
            new globalThis.Error(`Expected VerifInitialMatch, received ${error.reason._tag}`),
          );
        }
        assert.deepStrictEqual(error.reason.expect, { passed: true });
      }),
    );
  });
});
