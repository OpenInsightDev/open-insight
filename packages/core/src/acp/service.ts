import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  type ActiveSession,
  type ClientCapabilities,
  type ContentBlock,
  type Implementation,
  type InitializeResponse,
  type McpServer,
  type PromptCapabilities,
  type SessionUpdate,
  type Stream as AcpStream,
} from "@agentclientprotocol/sdk";
import { Cause, Effect, FiberSet, Layer, Option, Path, Queue, Ref, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import * as Agent from "#/agent/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { Bash } from "#/utils/index.ts";
import { type HttpStreamOptions, openHttpStream } from "./http.ts";
import { toAcpPrompt } from "./prompt.ts";
import { transform } from "./stream.ts";

const DEFAULT_CWD = "/workspace";
const DEFAULT_PORT = 7689;
const DEFAULT_PATH = "/acp";
const ACP_AGENT_INSTALL_URL =
  "https://github.com/OpenInsightDev/acp-agent/releases/latest/download/install.sh";

const unsupportedCapabilities = {
  fs: {
    readTextFile: false,
    writeTextFile: false,
  },
  terminal: false,
  session: null,
  plan: null,
  auth: {
    terminal: false,
  },
  elicitation: null,
  nes: null,
  positionEncodings: [],
} satisfies ClientCapabilities;

export interface Options extends HttpStreamOptions {
  readonly agentArgs?: ReadonlyArray<string>;
  readonly port?: number;
  readonly path?: string;
  readonly cwd?: string;
  readonly additionalDirectories?: ReadonlyArray<string>;
  readonly mcpServers?: ReadonlyArray<McpServer>;
  readonly clientInfo?: Implementation;
}

type StartTurn = (effect: Effect.Effect<void>) => void;

type SessionContext = Readonly<{
  session: ActiveSession;
  promptCapabilities: PromptCapabilities | undefined;
  startTurn: StartTurn;
  cancellingSessions: Set<string>;
  notifyCancel: () => Promise<void>;
  history: Ref.Ref<Prompt.Prompt>;
  turnActive: Ref.Ref<boolean>;
}>;

type MakeAgentOptions = Omit<SessionContext, "history" | "turnActive">;

type ResponseState = Readonly<{
  trajectory: Prompt.Prompt;
  responseParts: Array<Response.AnyPart>;
  committed: Ref.Ref<boolean>;
}>;

const protocolEffect = <A>(evaluate: () => Promise<A>): Effect.Effect<A, Agent.Error> =>
  Effect.tryPromise({
    try: evaluate,
    catch: Agent.Error.stream,
  });

const validateAbsolutePath = (
  pathService: Path.Path,
  label: string,
  path: string,
): Effect.Effect<void, Agent.Error> =>
  pathService.isAbsolute(path)
    ? Effect.void
    : Effect.fail(Agent.Error.stream(new TypeError(`${label} must be an absolute path: ${path}`)));

const validateOptions = Effect.fn("Acp.validateOptions")(function* (
  agentId: string,
  options: Options,
) {
  const path = yield* Path.Path;
  if (agentId.trim().length === 0) {
    return yield* Effect.fail(Agent.Error.stream(new TypeError("ACP agentId must not be empty")));
  }
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return yield* Effect.fail(
      Agent.Error.stream(new RangeError(`ACP agent port must be between 1 and 65535: ${port}`)),
    );
  }
  const endpointPath = options.path ?? DEFAULT_PATH;
  if (!endpointPath.startsWith("/") || endpointPath === "/" || endpointPath === "/health") {
    return yield* Effect.fail(
      Agent.Error.stream(new TypeError(`Invalid ACP agent endpoint path: ${endpointPath}`)),
    );
  }
  yield* validateAbsolutePath(path, "ACP session cwd", options.cwd ?? DEFAULT_CWD);
  yield* Effect.forEach(options.additionalDirectories ?? [], (directory, index) =>
    validateAbsolutePath(path, `ACP additional directory ${index}`, directory),
  );
});

const snapshotExtension = (agentId: string, options: Options): Agent.SnapshotExtension => {
  const port = String(options.port ?? DEFAULT_PORT);
  const path = options.path ?? DEFAULT_PATH;
  const serveArgs = [
    "serve",
    agentId,
    "--host",
    "0.0.0.0",
    "--port",
    port,
    "--path",
    path,
    ...(options.agentArgs === undefined ? [] : ["--", ...options.agentArgs]),
  ];

  return {
    instructions: [
      Snapshot.Inst.run(
        `curl -fsSL ${Bash.quote(ACP_AGENT_INSTALL_URL)} | ACP_AGENT_INSTALL_DIR=/usr/local/bin sh`,
      ),
      Snapshot.Inst.run("acp-agent install-env --yes"),
      Snapshot.Inst.run(`acp-agent install ${Bash.quote(agentId)}`),
      Snapshot.Inst.cmd("acp-agent", ...serveArgs),
    ],
  };
};

const userMessage = (trajectory: Prompt.Prompt): Effect.Effect<Prompt.UserMessage, Agent.Error> => {
  const message = trajectory.content[0];
  return trajectory.content.length === 1 && message?.role === "user"
    ? Effect.succeed(message)
    : Effect.fail(
        Agent.Error.stream(
          new TypeError("ACP session prompts must contain exactly one user message"),
        ),
      );
};

const cancelTurn = (
  sessionId: string,
  notify: () => Promise<void>,
  cancellingSessions: Set<string>,
) =>
  Effect.sync(() => cancellingSessions.add(sessionId)).pipe(
    Effect.andThen(protocolEffect(notify).pipe(Effect.ignore)),
  );

const cancelActiveTurn = (context: SessionContext) =>
  cancelTurn(context.session.sessionId, context.notifyCancel, context.cancellingSessions);

const sessionUpdateStream = (
  context: SessionContext,
  prompt: Array<ContentBlock>,
): Stream.Stream<SessionUpdate, Agent.Error> =>
  Effect.gen(function* () {
    const acquired = yield* Ref.modify(context.turnActive, (active) =>
      active ? [false, true] : [true, true],
    );
    if (!acquired) {
      return yield* Effect.fail(
        Agent.Error.stream(
          new globalThis.Error(
            `ACP session ${context.session.sessionId} already has an active prompt`,
          ),
        ),
      );
    }

    const queue = yield* Queue.unbounded<SessionUpdate, Agent.Error | Cause.Done>();
    const clearTurn = Ref.set(context.turnActive, false).pipe(
      Effect.andThen(
        Effect.sync(() => {
          context.cancellingSessions.delete(context.session.sessionId);
        }),
      ),
    );
    const pump = Effect.gen(function* () {
      yield* protocolEffect(() => context.session.prompt(prompt)).pipe(
        Effect.ignore,
        Effect.forkChild,
      );

      let stopped = false;
      while (!stopped) {
        const message = yield* protocolEffect(() => context.session.nextUpdate());
        if (message.kind === "stop") {
          stopped = true;
        } else {
          yield* Queue.offer(queue, message.update);
        }
      }
    });
    const producer = pump.pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          clearTurn.pipe(Effect.andThen(Queue.failCause(queue, cause)), Effect.asVoid),
        onSuccess: () => clearTurn.pipe(Effect.andThen(Queue.end(queue)), Effect.asVoid),
      }),
    );

    yield* Effect.sync(() => context.startTurn(producer));

    return Stream.fromQueue(queue).pipe(
      Stream.ensuring(
        Ref.get(context.turnActive).pipe(
          Effect.flatMap((active) => (active ? cancelActiveTurn(context) : Effect.void)),
        ),
      ),
    );
  }).pipe(Stream.unwrap);

const commitTrajectory = (context: SessionContext, state: ResponseState) =>
  Ref.getAndSet(state.committed, true).pipe(
    Effect.flatMap((alreadyCommitted) => {
      if (alreadyCommitted) {
        return Effect.void;
      }
      return Ref.update(context.history, (history) => {
        const withUserMessage = Prompt.concat(history, state.trajectory);
        return Prompt.concat(withUserMessage, Prompt.fromResponseParts(state.responseParts));
      });
    }),
  );

const responseStream = (
  context: SessionContext,
  prompt: Array<ContentBlock>,
  state: ResponseState,
) =>
  sessionUpdateStream(context, prompt).pipe(
    transform,
    Stream.tap((part) =>
      Effect.sync(() => {
        state.responseParts.push(part);
      }).pipe(
        Effect.andThen(part.type === "finish" ? commitTrajectory(context, state) : Effect.void),
      ),
    ),
  );

const promptStream = (
  context: SessionContext,
  trajectory: Prompt.Prompt,
): Stream.Stream<Agent.StreamPart, Agent.Error> =>
  Stream.suspend(() => {
    const responseParts: Array<Response.AnyPart> = [];

    return Effect.gen(function* () {
      const committed = yield* Ref.make(false);
      const state: ResponseState = { trajectory, responseParts, committed };
      const message = yield* userMessage(trajectory);
      const prompt = yield* toAcpPrompt(message, {
        promptCapabilities: context.promptCapabilities,
      }).pipe(Effect.mapError(Agent.Error.stream));
      return responseStream(context, prompt, state);
    }).pipe(Stream.unwrap);
  });

const makeAgent = (options: MakeAgentOptions): Effect.Effect<Agent.Agent, never> =>
  Effect.gen(function* () {
    const history = yield* Ref.make(Prompt.empty);
    const turnActive = yield* Ref.make(false);
    const context: SessionContext = {
      ...options,
      history,
      turnActive,
    };

    return {
      trajectory: () => Ref.get(context.history),
      prompt: (trajectory) => promptStream(context, trajectory),
    } satisfies Agent.Agent;
  });

export const makeProvider = Effect.fn("Acp.makeProvider")(function* (
  transport: AcpStream,
  agentId: string,
  options: Options,
) {
  yield* validateOptions(agentId, options);

  const runTurn = yield* FiberSet.makeRuntime<never, void, never>();
  const startTurn: StartTurn = (effect) => {
    runTurn(effect);
  };
  const cancellingSessions = new Set<string>();
  const app = client({ name: "open-insight" }).onRequest(
    methods.client.session.requestPermission,
    ({ params }) => {
      if (cancellingSessions.has(params.sessionId)) {
        return { outcome: { outcome: "cancelled" } };
      }
      throw RequestError.methodNotFound(methods.client.session.requestPermission);
    },
  );
  const connection = app.connect(transport);
  yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()));

  const initialized = yield* protocolEffect<InitializeResponse>(() =>
    connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: unsupportedCapabilities,
      ...(options.clientInfo === undefined ? {} : { clientInfo: options.clientInfo }),
    }),
  );
  if (initialized.protocolVersion !== PROTOCOL_VERSION) {
    return yield* Effect.fail(
      Agent.Error.stream(
        new globalThis.Error(
          `ACP agent selected unsupported protocol version ${initialized.protocolVersion}`,
        ),
      ),
    );
  }

  const runSession = Effect.fn("Acp.runSession")(function* (_sandbox) {
    const session = yield* protocolEffect<ActiveSession>(() =>
      connection.agent
        .buildSession({
          cwd: options.cwd ?? DEFAULT_CWD,
          additionalDirectories: [...(options.additionalDirectories ?? [])],
          mcpServers: [...(options.mcpServers ?? [])],
        })
        .start(),
    );

    return yield* makeAgent({
      session,
      promptCapabilities: initialized.agentCapabilities?.promptCapabilities,
      startTurn,
      cancellingSessions,
      notifyCancel: () =>
        connection.agent.notify(methods.agent.session.cancel, {
          sessionId: session.sessionId,
        }),
    });
  });

  return {
    snapshotExtension: Option.some(snapshotExtension(agentId, options)),
    runSession,
  } satisfies Agent.Provider;
});

export const layer = (url: string | URL, agentId: string, options: Options = {}) => {
  const provider = Effect.gen(function* () {
    const transport = yield* openHttpStream(url, { headers: options.headers }).pipe(
      Effect.mapError(Agent.Error.stream),
    );
    return yield* makeProvider(transport, agentId, options);
  });

  return Layer.effect(Agent.ProviderService)(provider).pipe(Layer.provide(Path.layer));
};
