import { Sandbox } from "@open-insight/core";
import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { LanguageModel, Prompt, Response } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { make } from "#/index.ts";

const finishPart: Response.FinishPartEncoded = {
  type: "finish",
  reason: "stop",
  usage: {
    inputTokens: {
      uncached: 0,
      total: 0,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 0,
      text: undefined,
      reasoning: undefined,
    },
  },
  response: undefined,
};

const makeSandbox = (files: Map<string, string>): Sandbox.Sandbox => ({
  spawn: () => Effect.die("unused test sandbox method"),
  exitCode: () => Effect.succeed(ExitCode(0)),
  success: () => Effect.void,
  stdout: () => Effect.succeed(""),
  stderr: () => Effect.succeed(""),
  cmd: () => Effect.die("unused test sandbox method"),
  readFile: ({ sandboxPath }) => Effect.succeed(files.get(sandboxPath) ?? ""),
  writeFile: ({ sandboxPath, content }) =>
    Effect.sync(() => {
      files.set(sandboxPath, content);
    }),
  download: () => Effect.die("unused test sandbox method"),
  upload: () => Effect.die("unused test sandbox method"),
  expose: () => Effect.die("unused test sandbox method"),
});

it.effect("runs a multi-turn agent workflow against one session sandbox", () =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    const modelPrompts: Array<string> = [];
    let turn = 0;
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart]),
      streamText: ({ prompt, tools }) => {
        modelPrompts.push(JSON.stringify(prompt));
        turn += 1;

        if (turn === 1) {
          return Stream.fromIterable([
            {
              type: "tool-call",
              id: "write-result",
              name: "SandboxWriteFile",
              params: { sandboxPath: "/workspace/result.txt", content: "first result" },
            } as const,
            finishPart,
          ]);
        }

        assert.deepStrictEqual(
          tools.map(({ name }) => name),
          ["SandboxExecute", "SandboxReadFile", "SandboxWriteFile"],
        );
        return Stream.fromIterable([
          {
            type: "tool-call",
            id: "read-result",
            name: "SandboxReadFile",
            params: { sandboxPath: "/workspace/result.txt" },
          } as const,
          { type: "text-start", id: "answer" } as const,
          { type: "text-delta", id: "answer", delta: "The result is ready." } as const,
          { type: "text-end", id: "answer" } as const,
          finishPart,
        ]);
      },
    });
    const provider = yield* make().pipe(Effect.provideService(LanguageModel.LanguageModel, llm));
    const agent = yield* provider.runSession(makeSandbox(files));

    const firstTurn = yield* agent
      .prompt(Prompt.make("Write the result to the workspace"))
      .pipe(Stream.runCollect);
    const secondTurn = yield* agent
      .prompt(Prompt.make("Read the result back"))
      .pipe(Stream.runCollect);
    const trajectory = yield* agent.trajectory();

    assert.strictEqual(files.get("/workspace/result.txt"), "first result");
    assert.include(JSON.stringify(firstTurn), '"sandboxPath":"/workspace/result.txt"');
    assert.include(JSON.stringify(secondTurn), '"result":"first result"');
    assert.include(modelPrompts[1], "Write the result to the workspace");
    assert.include(modelPrompts[1], "first result");
    assert.include(JSON.stringify(trajectory), "Read the result back");
    assert.strictEqual(turn, 2);
  }),
);
