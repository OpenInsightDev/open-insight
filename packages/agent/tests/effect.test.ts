import * as NodeServices from "@effect/platform-node/NodeServices";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Agent, Sandbox } from "@open-insight/core";
import { assert, it, layer as testLayer } from "@effect/vitest";
import { Context, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { LanguageModel, Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { z } from "zod";
import { Mcp, Skills, make } from "#/index.ts";
import { layer, toolkit } from "#/sandbox/index.ts";

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
    const tools = yield* toolkit.pipe(Effect.provide(layer));
    const results = yield* tools
      .handle("Execute", {
        command: "printf",
        args: ["hello"],
        cwd: "/workspace",
        env: undefined,
      })
      .pipe(Effect.flatMap(Stream.runCollect), Effect.provideService(Sandbox.Current, sandbox));

    const output = JSON.stringify({
      command: "printf",
      args: ["hello"],
      cwd: "/workspace",
      env: undefined,
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
    const tools = yield* toolkit.pipe(Effect.provide(layer));

    yield* tools
      .handle("WriteFile", { path: "/workspace/result.txt", content: "done" })
      .pipe(Effect.flatMap(Stream.runDrain), Effect.provideService(Sandbox.Current, sandbox));
    const results = yield* tools
      .handle("ReadFile", { path: "/workspace/result.txt" })
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
    let modelSteps = 0;
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart]),
      streamText: ({ prompt, tools }) => {
        modelSteps += 1;
        if (modelSteps === 1) {
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
        }

        assert.include(JSON.stringify(prompt), "prefix:HELLO");
        return Stream.fromIterable([
          { type: "text-start", id: "answer" } as const,
          { type: "text-delta", id: "answer", delta: "Read complete." } as const,
          { type: "text-end", id: "answer" } as const,
          finishPart,
        ]);
      },
    });
    const provider = yield* make(userToolkit).pipe(
      Effect.provide(userLayer),
      Effect.provideService(Prefix, "prefix:"),
      Effect.provideService(LanguageModel.LanguageModel, llm),
    );
    const agent = yield* provider.runSession(sandbox);
    const parts = yield* agent.prompt(Prompt.make("read the message")).pipe(Stream.runCollect);
    const toolResult = Array.from(parts).find((part) => part.type === "tool-result");

    assert.deepStrictEqual(exposedTools, ["Execute", "ReadFile", "WriteFile", "ReadUppercase"]);
    assert.strictEqual(toolResult?.type === "tool-result" && toolResult.result, "prefix:HELLO");
    assert.include(JSON.stringify(parts), "Read complete.");
    assert.strictEqual(modelSteps, 2);
  }),
);

it.effect("adds configured CLI help to the session instructions", () =>
  Effect.gen(function* () {
    const prompts: Array<string> = [];
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart]),
      streamText: ({ prompt }) => {
        prompts.push(JSON.stringify(prompt));
        return Stream.fromIterable([finishPart]);
      },
    });
    const provider = yield* make(Toolkit.empty, { cli: ["git"] }).pipe(
      Effect.provideService(LanguageModel.LanguageModel, llm),
    );
    const agent = yield* provider.runSession(makeSandbox(new Map()));

    yield* agent.prompt(Prompt.make("inspect the repository")).pipe(Stream.runDrain);

    assert.lengthOf(prompts, 1);
    assert.include(prompts[0], "CLI: git");
    assert.include(prompts[0], "Usage: git [arguments...]");
  }),
);

it.effect("stops an agent loop that exceeds maxSteps", () =>
  Effect.gen(function* () {
    let modelSteps = 0;
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart]),
      streamText: () => {
        modelSteps += 1;
        return Stream.fromIterable([
          {
            type: "tool-call",
            id: `read-${modelSteps}`,
            name: "ReadFile",
            params: { path: "/workspace/message.txt" },
          } as const,
          finishPart,
        ]);
      },
    });
    const provider = yield* make(Toolkit.empty, { maxSteps: 2 }).pipe(
      Effect.provideService(LanguageModel.LanguageModel, llm),
    );
    const agent = yield* provider.runSession(makeSandbox(new Map()));
    const error = yield* agent
      .prompt(Prompt.make("keep reading"))
      .pipe(Stream.runCollect, Effect.flip);

    assert.instanceOf(error, Agent.Error);
    assert.strictEqual(modelSteps, 2);
  }),
);

it.effect("runs independent sessions concurrently with isolated sandboxes and histories", () =>
  Effect.gen(function* () {
    let modelSteps = 0;
    const llm = yield* LanguageModel.make({
      generateText: () => Effect.succeed([finishPart]),
      streamText: ({ prompt }) => {
        modelSteps += 1;
        const history = JSON.stringify(prompt);
        const completed = history.includes("first-content")
          ? "first"
          : history.includes("second-content")
            ? "second"
            : undefined;

        if (completed !== undefined) {
          return Stream.fromIterable([
            { type: "text-start", id: `${completed}-answer` } as const,
            {
              type: "text-delta",
              id: `${completed}-answer`,
              delta: `${completed} complete`,
            } as const,
            { type: "text-end", id: `${completed}-answer` } as const,
            finishPart,
          ]);
        }

        const session = history.includes("first session") ? "first" : "second";
        return Stream.fromIterable([
          {
            type: "tool-call",
            id: `${session}-read`,
            name: "ReadFile",
            params: { path: "/workspace/message.txt" },
          } as const,
          finishPart,
        ]);
      },
    });
    const provider = yield* make(Toolkit.empty).pipe(
      Effect.provideService(LanguageModel.LanguageModel, llm),
    );
    const first = yield* provider.runSession(
      makeSandbox(new Map([["/workspace/message.txt", "first-content"]])),
    );
    const second = yield* provider.runSession(
      makeSandbox(new Map([["/workspace/message.txt", "second-content"]])),
    );

    const [firstParts, secondParts] = yield* Effect.all(
      [
        first.prompt(Prompt.make("first session")).pipe(Stream.runCollect),
        second.prompt(Prompt.make("second session")).pipe(Stream.runCollect),
      ],
      { concurrency: "unbounded" },
    );
    const firstHistory = yield* first.trajectory();
    const secondHistory = yield* second.trajectory();

    assert.include(JSON.stringify(firstParts), "first-content");
    assert.include(JSON.stringify(firstParts), "first complete");
    assert.isFalse(JSON.stringify(firstParts).includes("second-content"));
    assert.include(JSON.stringify(secondParts), "second-content");
    assert.include(JSON.stringify(secondParts), "second complete");
    assert.isFalse(JSON.stringify(secondParts).includes("first-content"));
    assert.include(JSON.stringify(firstHistory), "first-content");
    assert.isFalse(JSON.stringify(firstHistory).includes("second-content"));
    assert.include(JSON.stringify(secondHistory), "second-content");
    assert.isFalse(JSON.stringify(secondHistory).includes("first-content"));
    assert.strictEqual(modelSteps, 4);
  }),
);

testLayer(NodeServices.layer)("configured agent", (it) => {
  it.effect("adds skill instructions once across multiple prompts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const skillsDir = path.join(root, "skills");
      const skillDir = path.join(skillsDir, "review-code");
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: review-code",
          "description: Review code for correctness and regressions.",
          "---",
          "",
        ].join("\n"),
      );

      const prompts: Array<string> = [];
      const llm = yield* LanguageModel.make({
        generateText: () => Effect.succeed([finishPart]),
        streamText: ({ prompt }) => {
          prompts.push(JSON.stringify(prompt));
          return Stream.fromIterable([finishPart]);
        },
      });
      const provider = yield* make(Toolkit.empty).pipe(
        Effect.provide(Skills.layer(Skills.directory(skillsDir))),
        Effect.provideService(LanguageModel.LanguageModel, llm),
      );
      const agent = yield* provider.runSession(makeSandbox(new Map()));

      yield* agent.prompt(Prompt.make("first")).pipe(Stream.runDrain);
      yield* agent.prompt(Prompt.make("second")).pipe(Stream.runDrain);

      assert.lengthOf(prompts, 2);
      assert.strictEqual(prompts[1].split("Available skills:").length - 1, 1);
    }),
  );

  it.effect("combines custom tools, skills, and MCP servers", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const skillsDir = path.join(root, "skills");
      const skillDir = path.join(skillsDir, "review-code");
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: review-code",
          "description: Review code for correctness and regressions.",
          "---",
          "",
          "# Review Code",
          "",
        ].join("\n"),
      );

      const mcpServer = new McpServer(
        { name: "test-server", version: "1.0.0" },
        { instructions: "Use McpEcho when text must be echoed by the remote server." },
      );
      mcpServer.registerTool(
        "McpEcho",
        {
          description: "Echo text through MCP.",
          inputSchema: { text: z.string() },
        },
        ({ text }) => ({ content: [{ type: "text", text: `mcp:${text}` }] }),
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      yield* Effect.acquireRelease(
        Effect.tryPromise(() => mcpServer.connect(serverTransport)),
        () => Effect.promise(() => mcpServer.close()),
      );

      const exposedTools: Array<string> = [];
      const prompts: Array<string> = [];
      let modelSteps = 0;
      const llm = yield* LanguageModel.make({
        generateText: () => Effect.succeed([finishPart]),
        streamText: ({ prompt, tools }) => {
          modelSteps += 1;
          prompts.push(JSON.stringify(prompt));
          if (modelSteps > 1) {
            return Stream.fromIterable([
              { type: "text-start", id: "answer" } as const,
              { type: "text-delta", id: "answer", delta: "All tools completed." } as const,
              { type: "text-end", id: "answer" } as const,
              finishPart,
            ]);
          }

          exposedTools.push(...tools.map((tool) => tool.name));
          return Stream.fromIterable([
            {
              type: "tool-call",
              id: "read-uppercase",
              name: "ReadUppercase",
              params: { sandboxPath: "/workspace/message.txt" },
            } as const,
            {
              type: "tool-call",
              id: "mcp-echo",
              name: "McpEcho",
              params: { text: "hello" },
            } as const,
            finishPart,
          ]);
        },
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* make(userToolkit);
          const snapshot = Option.getOrThrow(provider.snapshotExtension);
          const sandbox = makeSandbox(new Map([["/workspace/message.txt", "hello from sandbox"]]));
          const agent = yield* provider.runSession(sandbox);
          const parts = yield* agent
            .prompt(Prompt.make("use every configured capability"))
            .pipe(Stream.runCollect);

          assert.deepStrictEqual(exposedTools, [
            "Execute",
            "ReadFile",
            "WriteFile",
            "ReadUppercase",
            "McpEcho",
          ]);
          assert.include(JSON.stringify(parts), "prefix:HELLO FROM SANDBOX");
          assert.include(JSON.stringify(parts), "mcp:hello");
          assert.include(JSON.stringify(parts), "All tools completed.");
          assert.include(prompts[1], "prefix:HELLO FROM SANDBOX");
          assert.include(prompts[1], "mcp:hello");
          assert.strictEqual(modelSteps, 2);
          assert.include(prompts[0], "/opt/open-insight/skills/review-code/SKILL.md");
          assert.include(prompts[0], "MCP server test-server instructions:");
          assert.include(prompts[0], "Use McpEcho when text must be echoed");
          assert.strictEqual(snapshot.context, root);
          assert.deepStrictEqual(snapshot.instructions, [
            {
              _tag: "Copy",
              src: ["skills"],
              dest: "/opt/open-insight/skills",
            },
          ]);
        }).pipe(
          Effect.provide(Mcp.layer([Mcp.fromTransport("test-server", clientTransport)])),
          Effect.provide(Skills.layer(Skills.directory(skillsDir))),
          Effect.provide(userLayer),
          Effect.provideService(Prefix, "prefix:"),
          Effect.provideService(LanguageModel.LanguageModel, llm),
        ),
      );
      assert.isFalse(mcpServer.isConnected());
    }),
  );

  it.effect("rejects MCP tools that collide with configured tools", () =>
    Effect.gen(function* () {
      const mcpServer = new McpServer({ name: "conflicting-server", version: "1.0.0" });
      mcpServer.registerTool("ReadUppercase", { inputSchema: { sandboxPath: z.string() } }, () => ({
        content: [{ type: "text", text: "unexpected" }],
      }));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      yield* Effect.acquireRelease(
        Effect.tryPromise(() => mcpServer.connect(serverTransport)),
        () => Effect.promise(() => mcpServer.close()),
      );

      const llm = yield* LanguageModel.make({
        generateText: () => Effect.succeed([finishPart]),
        streamText: () => Stream.fromIterable([finishPart]),
      });
      const error = yield* make(userToolkit).pipe(
        Effect.provide(Mcp.layer([Mcp.fromTransport("conflicting-server", clientTransport)])),
        Effect.provide(userLayer),
        Effect.provideService(Prefix, "prefix:"),
        Effect.provideService(LanguageModel.LanguageModel, llm),
        Effect.flip,
      );

      assert.instanceOf(error, Mcp.Error);
      assert.instanceOf(error.reason, Mcp.ToolConflict);
      assert.strictEqual(error.reason.toolName, "ReadUppercase");
      assert.deepStrictEqual(error.reason.sources, ["agent", "conflicting-server"]);
      assert.isFalse(mcpServer.isConnected());
    }),
  );

  it.effect("closes MCP connections when provider construction fails", () =>
    Effect.gen(function* () {
      const mcpServer = new McpServer({ name: "cleanup-server", version: "1.0.0" });
      mcpServer.registerTool("Cleanup", {}, () => ({ content: [{ type: "text", text: "ok" }] }));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      yield* Effect.acquireRelease(
        Effect.tryPromise(() => mcpServer.connect(serverTransport)),
        () => Effect.promise(() => mcpServer.close()),
      );

      const llm = yield* LanguageModel.make({
        generateText: () => Effect.succeed([finishPart]),
        streamText: () => Stream.fromIterable([finishPart]),
      });
      const error = yield* make(Toolkit.empty, { maxSteps: 0 }).pipe(
        Effect.provide(Mcp.layer([Mcp.fromTransport("cleanup-server", clientTransport)])),
        Effect.provideService(LanguageModel.LanguageModel, llm),
        Effect.flip,
      );

      assert.instanceOf(error, Agent.Error);
      assert.instanceOf(error.reason.cause, RangeError);
      assert.isFalse(mcpServer.isConnected());
    }),
  );
});
