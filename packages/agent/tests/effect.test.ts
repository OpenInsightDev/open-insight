import { Sandbox } from "@open-insight/core";
import { assert, it } from "@effect/vitest";
import { Context, Effect, Schema, Stream } from "effect";
import { LanguageModel, Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { make, makeWithToolkit } from "../src/agent.ts";
import { layer, toolkit } from "../src/toolkit.ts";

const makeSandbox = (files: Map<string, string>): Sandbox.Sandbox => ({
  spawn: ({ command, args, cwd, env }, options) =>
    Effect.sync(() => ({
      exitCode: ExitCode(7),
      stdout: JSON.stringify({ command, args, cwd, env, options }),
      stderr: "command failed",
    })),
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

it.effect("executes commands through the current sandbox", () =>
  Effect.gen(function* () {
    const sandbox = makeSandbox(new Map());
    const configuredToolkit = yield* toolkit.pipe(Effect.provide(layer));
    const results = yield* configuredToolkit
      .handle("SandboxExecute", {
        command: "printf",
        args: ["hello"],
        cwd: "/workspace",
        env: { TEST: "true" },
      })
      .pipe(Effect.flatMap(Stream.runCollect), Effect.provideService(Sandbox.Current, sandbox));

    const output = JSON.stringify({
      command: "printf",
      args: ["hello"],
      cwd: "/workspace",
      env: { TEST: "true" },
      options: { errorOnNonZeroExit: false },
    });
    assert.deepStrictEqual(Array.from(results), [
      {
        result: { exitCode: 7, stdout: output, stderr: "command failed" },
        encodedResult: { exitCode: 7, stdout: output, stderr: "command failed" },
        isFailure: false,
        preliminary: false,
      },
    ]);
  }),
);

it.effect("reads and writes files through the current sandbox", () =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    const sandbox = makeSandbox(files);
    const configuredToolkit = yield* toolkit.pipe(Effect.provide(layer));

    yield* configuredToolkit
      .handle("SandboxWriteFile", { sandboxPath: "/workspace/result.txt", content: "done" })
      .pipe(Effect.flatMap(Stream.runDrain), Effect.provideService(Sandbox.Current, sandbox));
    const results = yield* configuredToolkit
      .handle("SandboxReadFile", { sandboxPath: "/workspace/result.txt" })
      .pipe(Effect.flatMap(Stream.runCollect), Effect.provideService(Sandbox.Current, sandbox));

    assert.strictEqual(files.get("/workspace/result.txt"), "done");
    assert.strictEqual(Array.from(results)[0]?.result, "done");
  }),
);

class Prefix extends Context.Service<Prefix, string>()("test/Prefix") {}

const ReadUppercase = Tool.make("ReadUppercase", {
  parameters: Schema.Struct({ sandboxPath: Schema.String }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current, Prefix],
});

const userToolkit = Toolkit.make(ReadUppercase);
const userLayer = userToolkit.toLayer({
  ReadUppercase: Effect.fn(function* ({ sandboxPath }) {
    const sandbox = yield* Sandbox.Current;
    const prefix = yield* Prefix;
    return yield* sandbox.readFile({ sandboxPath }).pipe(
      Effect.map((content) => `${prefix}${content.toUpperCase()}`),
      Effect.mapError((error) => error.message),
    );
  }),
});

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

it.effect("injects the session sandbox into custom tools", () =>
  Effect.gen(function* () {
    const files = new Map([["/workspace/message.txt", "hello"]]);
    const sandbox = makeSandbox(files);
    const exposedTools: Array<string> = [];
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart]),
      streamText: ({ tools }) => {
        exposedTools.push(...tools.map((tool) => tool.name));
        return Stream.fromIterable([
          {
            type: "tool-call",
            id: "read-uppercase",
            name: "ReadUppercase",
            params: { sandboxPath: "/workspace/message.txt" },
          } as const,
          finishPart,
        ]);
      },
    });
    const provider = yield* makeWithToolkit(userToolkit).pipe(
      Effect.provide(userLayer),
      Effect.provideService(Prefix, "prefix:"),
      Effect.provideService(LanguageModel.LanguageModel, llm),
    );
    const agent = yield* provider.runSession(sandbox);
    const parts = yield* agent.prompt(Prompt.make("read the message")).pipe(Stream.runCollect);
    const toolResult = Array.from(parts).find((part) => part.type === "tool-result");

    assert.deepStrictEqual(exposedTools, [
      "SandboxExecute",
      "SandboxReadFile",
      "SandboxWriteFile",
      "ReadUppercase",
    ]);
    assert.strictEqual(toolResult?.type === "tool-result" && toolResult.result, "prefix:HELLO");
  }),
);

it.effect("creates isolated chat history for each session", () =>
  Effect.gen(function* () {
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([{ type: "text", text: "done" }, finishPart]),
      streamText: () =>
        Stream.fromIterable([
          { type: "text-start", id: "session" } as const,
          { type: "text-delta", id: "session", delta: "done" } as const,
          { type: "text-end", id: "session" } as const,
          finishPart,
        ]),
    });
    const provider = yield* make().pipe(Effect.provideService(LanguageModel.LanguageModel, llm));
    const sandbox = makeSandbox(new Map());
    const first = yield* provider.runSession(sandbox);
    const second = yield* provider.runSession(sandbox);

    yield* first.prompt(Prompt.make("first session")).pipe(Stream.runDrain);
    const firstTrajectory = yield* first.trajectory();
    const secondTrajectory = yield* second.trajectory();

    assert.include(JSON.stringify(firstTrajectory), "first session");
    assert.strictEqual(secondTrajectory.content.length, 0);
  }),
);
