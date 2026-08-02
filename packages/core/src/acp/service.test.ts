import {
  PROTOCOL_VERSION,
  RequestError,
  agent,
  methods,
  type AnyMessage,
  type InitializeRequest,
  type NewSessionRequest,
  type PromptRequest,
  type Stream as AcpStream,
} from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Option, Path, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Agent from "#/agent/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import { makeProvider } from "./service.ts";

const streamPair = (): readonly [AcpStream, AcpStream] => {
  const leftToRight = new TransformStream<AnyMessage>();
  const rightToLeft = new TransformStream<AnyMessage>();

  return [
    {
      readable: rightToLeft.readable,
      writable: leftToRight.writable,
    },
    {
      readable: leftToRight.readable,
      writable: rightToLeft.writable,
    },
  ];
};

const unusedSandboxOperation = () =>
  Effect.die(new globalThis.Error("The ACP provider does not use the local sandbox handle"));

const sandbox = {
  spawn: unusedSandboxOperation,
  exitCode: unusedSandboxOperation,
  success: unusedSandboxOperation,
  stdout: unusedSandboxOperation,
  stderr: unusedSandboxOperation,
  cmd: unusedSandboxOperation,
  readFile: unusedSandboxOperation,
  writeFile: unusedSandboxOperation,
  download: unusedSandboxOperation,
  upload: unusedSandboxOperation,
  expose: unusedSandboxOperation,
} satisfies Sandbox.Sandbox;

const assertTrajectoryIncludes = (agent: Agent.Agent, text: string) =>
  agent
    .trajectory()
    .pipe(
      Effect.tap((trajectory) =>
        Effect.sync(() => assert.include(JSON.stringify(trajectory), text)),
      ),
    );

it.effect("initializes once and keeps ACP sessions isolated across turns", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initializeRequests: Array<InitializeRequest> = [];
      const newSessionRequests: Array<NewSessionRequest> = [];
      const promptRequests: Array<PromptRequest> = [];
      const unsupportedCodes: Array<number> = [];
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "test-agent" })
        .onRequest(methods.agent.initialize, ({ params }) => {
          initializeRequests.push(params);
          return {
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: {
              loadSession: false,
              promptCapabilities: {},
            },
          };
        })
        .onRequest(methods.agent.session.new, ({ params }) => {
          newSessionRequests.push(params);
          return { sessionId: `session-${newSessionRequests.length}` };
        })
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.prompt, async ({ client, params }) => {
          promptRequests.push(params);
          try {
            await client.request(methods.client.fs.readTextFile, {
              sessionId: params.sessionId,
              path: "/workspace/unsupported.txt",
            });
          } catch (cause) {
            if (cause instanceof RequestError) {
              unsupportedCodes.push(cause.code);
            } else {
              throw cause;
            }
          }

          const text = params.prompt.find((block) => block.type === "text")?.text ?? "";
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: `${params.sessionId}:${text}` },
            },
          });
          return { stopReason: "end_turn" };
        })
        .onNotification(methods.agent.session.cancel, () => undefined);
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));
      const provider = yield* makeProvider(clientStream, "test-agent", {
        cwd: "/workspace",
        additionalDirectories: ["/fixtures"],
      }).pipe(Effect.provide(Path.layer));

      const extension = Option.getOrThrow(provider.snapshotExtension);
      assert.deepStrictEqual(extension.instructions, [
        {
          _tag: "Run",
          cmd: "curl -fsSL 'https://github.com/OpenInsightDev/acp-agent/releases/latest/download/install.sh' | ACP_AGENT_INSTALL_DIR=/usr/local/bin sh",
        },
        { _tag: "Run", cmd: "acp-agent install-env --yes" },
        { _tag: "Run", cmd: "acp-agent install 'test-agent'" },
        {
          _tag: "Cmd",
          cmd: [
            "acp-agent",
            "serve",
            "test-agent",
            "--host",
            "0.0.0.0",
            "--port",
            "8010",
            "--path",
            "/acp",
          ],
        },
      ]);
      const first = yield* provider.runSession(sandbox);
      const second = yield* provider.runSession(sandbox);
      const firstTurn = yield* first.prompt(Prompt.make("first")).pipe(
        Stream.tap((part) =>
          part.type === "finish" ? assertTrajectoryIncludes(first, "session-1:first") : Effect.void,
        ),
        Stream.runCollect,
      );
      yield* first.prompt(Prompt.make("follow-up")).pipe(Stream.runDrain);
      const secondTurn = yield* second.prompt(Prompt.make("second")).pipe(Stream.runCollect);
      const firstTrajectory = yield* first.trajectory();
      const secondTrajectory = yield* second.trajectory();

      assert.lengthOf(initializeRequests, 1);
      assert.deepStrictEqual(initializeRequests[0]?.clientCapabilities, {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        session: null,
        plan: null,
        auth: { terminal: false },
        elicitation: null,
        nes: null,
        positionEncodings: [],
      });
      assert.deepStrictEqual(newSessionRequests, [
        { cwd: "/workspace", additionalDirectories: ["/fixtures"], mcpServers: [] },
        { cwd: "/workspace", additionalDirectories: ["/fixtures"], mcpServers: [] },
      ]);
      assert.deepStrictEqual(
        promptRequests.map(({ sessionId }) => sessionId),
        ["session-1", "session-1", "session-2"],
      );
      assert.deepStrictEqual(unsupportedCodes, [-32601, -32601, -32601]);
      assert.include(JSON.stringify(firstTurn), "session-1:first");
      assert.notInclude(JSON.stringify(firstTurn), "session-2");
      assert.include(JSON.stringify(secondTurn), "session-2:second");
      assert.notInclude(JSON.stringify(secondTurn), "session-1");
      assert.include(JSON.stringify(firstTrajectory), "follow-up");
      assert.notInclude(JSON.stringify(firstTrajectory), "session-2");
      assert.include(JSON.stringify(secondTrajectory), "session-2:second");
      assert.notInclude(JSON.stringify(secondTrajectory), "session-1");
    }),
  ),
);

it.effect("cancels an interrupted turn and leaves its partial response out of the trajectory", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const cancelled = yield* Deferred.make<void>();
      const promptStopped = yield* Deferred.make<void>();
      const cancelRequests: Array<string> = [];
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "cancelling-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: false },
        }))
        .onRequest(methods.agent.session.new, () => ({ sessionId: "cancel-session" }))
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.prompt, async ({ client, params }) => {
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "partial" },
            },
          });
          await Effect.runPromise(Deferred.await(cancelled));
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "cancelled-tool",
              status: "failed",
            },
          });
          await Effect.runPromise(Deferred.succeed(promptStopped, void 0));
          return { stopReason: "cancelled" };
        })
        .onNotification(methods.agent.session.cancel, ({ params }) => {
          cancelRequests.push(params.sessionId);
          return Effect.runPromise(Deferred.succeed(cancelled, void 0)).then(() => undefined);
        });
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));
      const provider = yield* makeProvider(clientStream, "cancelling-agent", {
        cwd: "/workspace",
      }).pipe(Effect.provide(Path.layer));
      const session = yield* provider.runSession(sandbox);

      const parts = yield* session
        .prompt(Prompt.make("cancel me"))
        .pipe(Stream.take(2), Stream.runCollect);
      yield* Deferred.await(promptStopped);
      const trajectory = yield* session.trajectory();

      assert.include(JSON.stringify(parts), "partial");
      assert.deepStrictEqual(cancelRequests, ["cancel-session"]);
      assert.deepStrictEqual(trajectory, Prompt.empty);
    }),
  ),
);

it.effect("rejects prompts that do not represent exactly one ACP user turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let promptCount = 0;
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "validation-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: false },
        }))
        .onRequest(methods.agent.session.new, () => ({ sessionId: "validation-session" }))
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.prompt, () => {
          promptCount += 1;
          return { stopReason: "end_turn" };
        })
        .onNotification(methods.agent.session.cancel, () => undefined);
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));
      const provider = yield* makeProvider(clientStream, "validation-agent", {
        cwd: "/workspace",
      }).pipe(Effect.provide(Path.layer));
      const session = yield* provider.runSession(sandbox);
      const invalid = Prompt.make([
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ]);

      const error = yield* session.prompt(invalid).pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, Agent.Error);
      assert.include(error.message, "exactly one user message");
      assert.strictEqual(promptCount, 0);
    }),
  ),
);
