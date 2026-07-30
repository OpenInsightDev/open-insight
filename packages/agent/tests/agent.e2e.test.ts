import { Sandbox } from "@open-insight/core";
import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { LanguageModel, Prompt, Response } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { make } from "#/index.ts";

const finishPart = (tokens: number): Response.FinishPartEncoded => ({
  type: "finish",
  reason: "stop",
  usage: {
    inputTokens: {
      uncached: tokens,
      total: tokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: tokens,
      text: tokens,
      reasoning: undefined,
    },
  },
  response: undefined,
});

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

it.effect("runs a multi-step agent loop against one session sandbox", () =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    const modelPrompts: Array<string> = [];
    let turn = 0;
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart(0)]),
      streamText: ({ prompt, tools }) => {
        modelPrompts.push(JSON.stringify(prompt));
        turn += 1;

        if (turn === 1) {
          return Stream.fromIterable([
            {
              type: "tool-call",
              id: "write-result",
              name: "WriteFile",
              params: { path: "/workspace/result.txt", content: "first result" },
            } as const,
            finishPart(turn),
          ]);
        }

        if (turn === 2) {
          assert.deepStrictEqual(
            tools.map(({ name }) => name),
            ["Execute", "ReadFile", "WriteFile"],
          );
          return Stream.fromIterable([
            {
              type: "tool-call",
              id: "read-result",
              name: "ReadFile",
              params: { path: "/workspace/result.txt" },
            } as const,
            finishPart(turn),
          ]);
        }

        return Stream.fromIterable([
          { type: "text-start", id: "answer" } as const,
          { type: "text-delta", id: "answer", delta: "The result is ready." } as const,
          { type: "text-end", id: "answer" } as const,
          finishPart(turn),
        ]);
      },
    });
    const provider = yield* make().pipe(Effect.provideService(LanguageModel.LanguageModel, llm));
    const agent = yield* provider.runSession(makeSandbox(files));

    const parts = yield* agent
      .prompt(Prompt.make("Write the result to the workspace, then read it back"))
      .pipe(
        Stream.tap((part) =>
          part.type === "finish"
            ? agent.trajectory().pipe(
                Effect.tap((trajectory) =>
                  Effect.sync(() => {
                    assert.include(JSON.stringify(trajectory), "The result is ready.");
                  }),
                ),
              )
            : Effect.void,
        ),
        Stream.runCollect,
      );
    const trajectory = yield* agent.trajectory();

    assert.strictEqual(files.get("/workspace/result.txt"), "first result");
    assert.include(JSON.stringify(parts), '"path":"/workspace/result.txt"');
    assert.include(JSON.stringify(parts), '"result":"first result"');
    assert.include(JSON.stringify(parts), "The result is ready.");
    const finishes = Array.from(parts).filter((part) => part.type === "finish");
    assert.lengthOf(finishes, 1);
    assert.strictEqual(finishes[0]?.type === "finish" && finishes[0].usage.inputTokens.total, 6);
    assert.strictEqual(finishes[0]?.type === "finish" && finishes[0].usage.outputTokens.total, 6);
    assert.include(modelPrompts[1], "Write the result to the workspace");
    assert.include(modelPrompts[1], "first result");
    assert.include(modelPrompts[2], "first result");
    assert.include(JSON.stringify(trajectory), "then read it back");
    assert.include(JSON.stringify(trajectory), "The result is ready.");
    assert.strictEqual(turn, 3);
  }),
);
