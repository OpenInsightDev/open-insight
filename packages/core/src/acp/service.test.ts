import {
  PROTOCOL_VERSION,
  RequestError,
  agent as createAgent,
  methods,
  type AgentApp,
  type AnyMessage,
  type InitializeRequest,
  type NewSessionRequest,
  type PromptRequest,
} from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Option, Path, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Prompt } from "effect/unstable/ai";
import * as Agent from "#/agent/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import { AcpError, AuthenticationError } from "./error.ts";
import { makeProvider, type Options, waitForAgentReady } from "./service.ts";

class AgentWebSocket {
  static app: AgentApp | undefined;

  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  private readonly connection;
  private controller: ReadableStreamDefaultController<AnyMessage> | undefined;
  private closed = false;

  readonly readyState = 1;

  constructor(
    readonly url: string,
    readonly protocols?: string | Array<string>,
    readonly options?: { readonly headers?: Record<string, string> },
  ) {
    const app = AgentWebSocket.app;
    if (app === undefined) {
      throw new Error("No ACP test agent configured");
    }

    const readable = new ReadableStream<AnyMessage>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.connection = app.connect({
      readable,
      writable: new WritableStream<AnyMessage>({
        write: (message) => {
          this.emit("message", { data: JSON.stringify(message) });
        },
      }),
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.controller?.enqueue(JSON.parse(data) as AnyMessage);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.controller?.close();
    this.connection.close();
    this.emit("close", {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const testSandbox = {
  spawn: () => Effect.die("not used"),
  exitCode: () => Effect.die("not used"),
  success: () => Effect.die("not used"),
  stdout: () => Effect.die("not used"),
  stderr: () => Effect.die("not used"),
  readFile: () => Effect.die("not used"),
  writeFile: () => Effect.die("not used"),
  download: () => Effect.die("not used"),
  upload: () => Effect.die("not used"),
  expose: () => Effect.succeed({ hostUrl: "ws://agent.test" }),
} satisfies Sandbox.Sandbox;

const transportOptions = {
  WebSocket: AgentWebSocket,
  fetch: async () => new Response(null, { status: 204 }),
} satisfies Pick<Options, "WebSocket" | "fetch">;

const providerError = (error: Agent.AgentError) => {
  assert.strictEqual(error.reason._tag, "StreamError");
  if (error.reason._tag !== "StreamError") {
    assert.fail(`Expected StreamError, received ${error.reason._tag}`);
  }
  return error.reason.cause;
};

const authenticationError = (cause: unknown): AuthenticationError => {
  assert.instanceOf(cause, AcpError);
  if (!(cause instanceof AcpError) || !(cause.reason instanceof AuthenticationError)) {
    assert.fail("Expected an ACP authentication error");
  }
  return cause.reason;
};

const runSession = (app: AgentApp, options: Options = {}) =>
  Effect.gen(function* () {
    AgentWebSocket.app = app;
    const provider = yield* makeProvider("test-agent", { ...transportOptions, ...options }).pipe(
      Effect.provide(Path.layer),
    );
    return yield* provider.runSession(testSandbox);
  });

it.effect("waits longer than ten seconds for a cold agent to become ready", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = async () => {
      attempts += 1;
      if (attempts <= 21) {
        throw new TypeError("connect ECONNREFUSED");
      }
      return new Response(null, { status: 200 });
    };

    const ready = yield* waitForAgentReady(new URL("http://agent.test/acp"), { fetch }).pipe(
      Effect.forkChild,
    );
    yield* TestClock.adjust("11 seconds");
    yield* Fiber.join(ready);

    assert.strictEqual(attempts, 22);
  }),
);

it.effect("rejects invalid provider configuration before it creates a snapshot", () =>
  Effect.gen(function* () {
    const cases = [
      {
        agentId: "   ",
        options: {},
        message: "ACP agentId must not be empty",
      },
      {
        agentId: "test-agent",
        options: { port: 0 },
        message: "ACP agent port must be between 1 and 65535: 0",
      },
      {
        agentId: "test-agent",
        options: { path: "/health" },
        message: "Invalid ACP agent endpoint path: /health",
      },
      {
        agentId: "test-agent",
        options: { cwd: "workspace" },
        message: "ACP session cwd must be an absolute path: workspace",
      },
      {
        agentId: "test-agent",
        options: { additionalDirectories: ["/repo", "relative"] },
        message: "ACP additional directory 1 must be an absolute path: relative",
      },
      {
        agentId: "test-agent",
        options: { serveEnv: { "NOT-VALID": "value" } },
        message: "Invalid ACP serve environment variable name: NOT-VALID",
      },
    ] satisfies ReadonlyArray<Readonly<{ agentId: string; options: Options; message: string }>>;

    for (const testCase of cases) {
      const error = yield* makeProvider(testCase.agentId, testCase.options).pipe(
        Effect.provide(Path.layer),
        Effect.flip,
      );
      const cause = providerError(error);

      assert.instanceOf(cause, Error);
      assert.strictEqual(cause.message, testCase.message);
    }
  }),
);

it.effect("generates an ACP snapshot with validated serve options", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider("agent with spaces", {
      port: 9010,
      path: "/custom-acp",
      agentArgs: ["--model", "test"],
      serveEnv: { TEST_MODE: "1" },
      disableYolo: true,
    }).pipe(Effect.provide(Path.layer));
    const extension = Option.getOrThrow(provider.snapshotExtension);
    const environment = extension.instructions.find((instruction) => instruction._tag === "Env");
    const command = extension.instructions.find((instruction) => instruction._tag === "Cmd");
    const install = extension.instructions.find(
      (instruction) =>
        instruction._tag === "Run" && instruction.cmd.startsWith("acp-agent install "),
    );

    assert.deepStrictEqual(environment, { _tag: "Env", env: { TEST_MODE: "1" } });
    assert.deepStrictEqual(command, {
      _tag: "Cmd",
      cmd: [
        "acp-agent",
        "serve",
        "agent with spaces",
        "--host",
        "0.0.0.0",
        "--port",
        "9010",
        "--path",
        "/custom-acp",
        "--",
        "--model",
        "test",
      ],
    });
    assert.strictEqual(
      install?._tag === "Run" && install.cmd,
      "acp-agent install 'agent with spaces'",
    );
  }),
);

it.effect(
  "negotiates authentication, creates the requested session, and streams prompt updates",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initialized: Array<InitializeRequest> = [];
        const sessions: Array<NewSessionRequest> = [];
        const prompts: Array<PromptRequest> = [];
        const authenticated: Array<string> = [];
        const app = createAgent({ name: "test-agent" })
          .onRequest(methods.agent.initialize, ({ params }) => {
            initialized.push(params);
            return {
              protocolVersion: PROTOCOL_VERSION,
              authMethods: [{ id: "agent-login", name: "Agent login" }],
              agentCapabilities: {
                promptCapabilities: { image: true },
              },
            };
          })
          .onRequest(methods.agent.authenticate, ({ params }) => {
            authenticated.push(params.methodId);
            return {};
          })
          .onRequest(methods.agent.session.new, ({ params }) => {
            sessions.push(params);
            return { sessionId: "session-1" };
          })
          .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
            prompts.push(params);
            await client.notify(methods.client.session.update, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "agent response" },
              },
            });
            return { stopReason: "end_turn" };
          })
          .onNotification(methods.agent.session.cancel, () => undefined);
        const session = yield* runSession(app, {
          auth: { methodId: "agent-login" },
          cwd: "/repo",
          additionalDirectories: ["/shared"],
          mcpServers: [],
          clientInfo: { name: "Open Insight Test", version: "test" },
        });
        const parts = yield* session.prompt(Prompt.make("inspect this")).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        );

        const initialize = initialized[0];
        if (initialize === undefined) {
          assert.fail("The ACP client did not initialize the agent");
          return;
        }
        const clientCapabilities = initialize.clientCapabilities;
        if (clientCapabilities === undefined) {
          assert.fail("The ACP client did not send its capabilities");
          return;
        }
        assert.strictEqual(initialized.length, 1);
        assert.strictEqual(initialize.protocolVersion, PROTOCOL_VERSION);
        assert.deepStrictEqual(clientCapabilities.fs, {
          readTextFile: false,
          writeTextFile: false,
        });
        assert.deepStrictEqual(authenticated, ["agent-login"]);
        assert.deepStrictEqual(sessions, [
          {
            cwd: "/repo",
            additionalDirectories: ["/shared"],
            mcpServers: [],
          },
        ]);
        assert.deepStrictEqual(prompts, [
          {
            sessionId: "session-1",
            prompt: [{ type: "text", text: "inspect this" }],
          },
        ]);
        assert.strictEqual(
          parts.some((part) => part.type === "text-start"),
          true,
        );
        assert.strictEqual(
          parts.some((part) => part.type === "text-delta" && part.delta === "agent response"),
          true,
        );
      }),
    ),
);

it.effect("rejects an authentication method the initialized agent did not advertise", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const app = createAgent({ name: "test-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "supported", name: "Supported" }],
        }))
        .onRequest(methods.agent.authenticate, () => ({}))
        .onRequest(methods.agent.session.new, () => ({ sessionId: "session-1" }));
      const error = yield* runSession(app, { auth: { methodId: "missing" } }).pipe(Effect.flip);
      const cause = providerError(error);

      const authentication = authenticationError(cause);
      assert.strictEqual(authentication.reason, "unsupported_method");
      assert.deepStrictEqual(authentication.availableMethodIds, ["supported"]);
    }),
  ),
);

it.effect("turns an authentication-required session creation response into a typed ACP error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const app = createAgent({ name: "test-agent" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "browser", name: "Browser" }],
        }))
        .onRequest(methods.agent.session.new, () => {
          throw new RequestError(-32_000, "Authentication required");
        });
      const error = yield* runSession(app).pipe(Effect.flip);
      const cause = providerError(error);

      const authentication = authenticationError(cause);
      assert.strictEqual(authentication.reason, "authentication_required");
      assert.deepStrictEqual(authentication.availableMethodIds, ["browser"]);
    }),
  ),
);
