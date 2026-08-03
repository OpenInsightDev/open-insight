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
import { assert, layer } from "@effect/vitest";
import { Deferred, Effect, Option, Path, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Agent from "#/agent/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import { Error as AcpError } from "./error.ts";
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

layer(Path.layer)((it) => {
  it.effect("initializes once and keeps ACP sessions isolated across turns", () =>
    Effect.gen(function* () {
      const initializeRequests: Array<InitializeRequest> = [];
      const authenticationRequests: Array<{ methodId: string }> = [];
      const newSessionRequests: Array<NewSessionRequest> = [];
      const promptRequests: Array<PromptRequest> = [];
      const unsupportedCodes: Array<number> = [];
      const requestOrder: Array<string> = [];
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "test-agent" })
        .onRequest(methods.agent.initialize, ({ params }) => {
          initializeRequests.push(params);
          requestOrder.push("initialize");
          return {
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: {
              loadSession: false,
              promptCapabilities: {},
            },
            authMethods: [{ id: "api-key", name: "API key" }],
          };
        })
        .onRequest(methods.agent.session.new, ({ params }) => {
          newSessionRequests.push(params);
          requestOrder.push("session/new");
          return { sessionId: `session-${newSessionRequests.length}` };
        })
        .onRequest(methods.agent.authenticate, ({ params }) => {
          authenticationRequests.push(params);
          requestOrder.push("authenticate");
          return {};
        })
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
        auth: { methodId: "api-key" },
      });

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
            "7689",
            "--path",
            "/acp",
            "--yolo",
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
      assert.deepStrictEqual(authenticationRequests, [{ methodId: "api-key" }]);
      assert.deepStrictEqual(requestOrder.slice(0, 3), [
        "initialize",
        "authenticate",
        "session/new",
      ]);
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
  );

  it.effect("allows advertised authentication methods when a session does not require them", () =>
    Effect.gen(function* () {
      let authenticationCount = 0;
      let sessionCreated = false;
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "optional-authentication-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "api-key", name: "API key" }],
        }))
        .onRequest(methods.agent.authenticate, () => {
          authenticationCount += 1;
          return {};
        })
        .onRequest(methods.agent.session.new, () => {
          sessionCreated = true;
          return { sessionId: "optional-authentication-session" };
        });
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));

      const provider = yield* makeProvider(clientStream, "optional-authentication-agent", {
        cwd: "/workspace",
      });
      yield* provider.runSession(sandbox);

      assert.strictEqual(authenticationCount, 0);
      assert.isTrue(sessionCreated);
    }),
  );

  it.effect("maps a session authentication requirement to a typed ACP cause", () =>
    Effect.gen(function* () {
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "authentication-required-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "api-key", name: "API key" }],
        }))
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.new, () => {
          throw RequestError.authRequired({ reason: "missing credentials" });
        });
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));

      const provider = yield* makeProvider(clientStream, "authentication-required-agent", {
        cwd: "/workspace",
      });
      const error = yield* provider.runSession(sandbox).pipe(Effect.flip);

      assert.instanceOf(error, Agent.Error);
      assert.strictEqual(error.reason._tag, "StreamError");
      if (error.reason._tag !== "StreamError") {
        return;
      }
      assert.instanceOf(error.reason.cause, AcpError);
      const cause = error.reason.cause;
      if (!(cause instanceof AcpError)) {
        return;
      }
      assert.strictEqual(cause.reason._tag, "AcpAuthenticationError");
      if (cause.reason._tag === "AcpAuthenticationError") {
        assert.strictEqual(cause.reason.reason, "authentication_required");
        assert.deepStrictEqual(cause.reason.availableMethodIds, ["api-key"]);
        assert.instanceOf(cause.reason.cause, RequestError);
      }
    }),
  );

  it.effect("rejects configured authentication methods the agent did not advertise", () =>
    Effect.gen(function* () {
      let authenticationCount = 0;
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "unsupported-authentication-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "api-key", name: "API key" }],
        }))
        .onRequest(methods.agent.authenticate, () => {
          authenticationCount += 1;
          return {};
        });
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));

      const error = yield* makeProvider(clientStream, "unsupported-authentication-agent", {
        cwd: "/workspace",
        auth: { methodId: "chat-gpt" },
      }).pipe(Effect.flip);

      assert.instanceOf(error, AcpError);
      assert.strictEqual(error.reason._tag, "AcpAuthenticationError");
      if (error.reason._tag === "AcpAuthenticationError") {
        assert.strictEqual(error.reason.reason, "unsupported_method");
        assert.strictEqual(error.reason.methodId, "chat-gpt");
        assert.deepStrictEqual(error.reason.availableMethodIds, ["api-key"]);
      }
      assert.strictEqual(authenticationCount, 0);
    }),
  );

  it.effect("wraps authentication request failures in an ACP authentication error", () =>
    Effect.gen(function* () {
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "authentication-failure-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "api-key", name: "API key" }],
        }))
        .onRequest(methods.agent.authenticate, () => {
          throw RequestError.authRequired("invalid API key");
        });
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));

      const error = yield* makeProvider(clientStream, "authentication-failure-agent", {
        cwd: "/workspace",
        auth: { methodId: "api-key" },
      }).pipe(Effect.flip);

      assert.instanceOf(error, AcpError);
      assert.strictEqual(error.reason._tag, "AcpAuthenticationError");
      if (error.reason._tag === "AcpAuthenticationError") {
        assert.strictEqual(error.reason.reason, "authentication_failed");
        assert.strictEqual(error.reason.methodId, "api-key");
        assert.instanceOf(error.reason.cause, RequestError);
      }
    }),
  );

  it.effect(
    "cancels an interrupted turn and leaves its partial response out of the trajectory",
    () =>
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
        });
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
  );

  it.effect("rejects prompts that do not represent exactly one ACP user turn", () =>
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
      });
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
  );

  it.effect("omits --yolo from the acp-agent serve command when disabled", () =>
    Effect.gen(function* () {
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "yolo-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: false },
        }))
        .onRequest(methods.agent.session.new, () => ({ sessionId: "yolo-session" }))
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.prompt, () => ({ stopReason: "end_turn" }))
        .onNotification(methods.agent.session.cancel, () => undefined);
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));
      const provider = yield* makeProvider(clientStream, "yolo-agent", {
        cwd: "/workspace",
        disableYolo: true,
      });

      const extension = Option.getOrThrow(provider.snapshotExtension);
      const serveInstruction = extension.instructions.at(-1);
      assert.deepStrictEqual(serveInstruction, {
        _tag: "Cmd",
        cmd: [
          "acp-agent",
          "serve",
          "yolo-agent",
          "--host",
          "0.0.0.0",
          "--port",
          "7689",
          "--path",
          "/acp",
        ],
      });
      assert.notInclude(JSON.stringify(serveInstruction), "--yolo");
    }),
  );

  it.effect("adds configured serve environment to the snapshot", () =>
    Effect.gen(function* () {
      const [clientStream, agentStream] = streamPair();
      const app = agent({ name: "configured-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: false },
        }))
        .onRequest(methods.agent.session.new, () => ({ sessionId: "configured-session" }))
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.prompt, () => ({ stopReason: "end_turn" }))
        .onNotification(methods.agent.session.cancel, () => undefined);
      const agentConnection = app.connect(agentStream);
      yield* Effect.addFinalizer(() => Effect.sync(() => agentConnection.close()));
      const provider = yield* makeProvider(clientStream, "configured-agent", {
        cwd: "/workspace",
        serveEnv: {
          DEFAULT_AUTH_REQUEST: '{"methodId":"api-key"}',
          CODEX_CONFIG: '{"model":"gpt-5"}',
        },
      });

      const extension = Option.getOrThrow(provider.snapshotExtension);
      assert.deepStrictEqual(extension.instructions.at(-2), {
        _tag: "Env",
        env: {
          DEFAULT_AUTH_REQUEST: '{"methodId":"api-key"}',
          CODEX_CONFIG: '{"model":"gpt-5"}',
        },
      });
    }),
  );
});
