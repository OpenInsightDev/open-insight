import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Exit, Layer, Schema, Scope } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { Server } from "./config.ts";
import { callTool, connectScoped, listTools, type ConnectedClient } from "./client.ts";
import { ToolNameConflictError } from "./error.ts";

export type Tools = Record<
  string,
  Tool.Dynamic<
    string,
    {
      readonly parameters: McpTool["inputSchema"];
      readonly success: typeof Schema.Unknown;
      readonly failure: typeof Schema.String;
      readonly failureMode: "return";
    }
  >
>;

export type ConnectedToolkit = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  layer: Layer.Layer<Tool.HandlersFor<Tools>>;
  systemInstructions?: string;
  close: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>;
}>;

type DiscoveredTool = Readonly<{
  client: ConnectedClient;
  definition: McpTool;
}>;

const decodeParameters = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));

const discover = Effect.fn(function* (servers: ReadonlyArray<Server>) {
  const clients = yield* Effect.forEach(servers, connectScoped);
  const tools = yield* Effect.forEach(clients, (client) =>
    listTools(client).pipe(
      Effect.map((tools) => tools.map((definition) => ({ client, definition }))),
    ),
  ).pipe(Effect.map((groups) => groups.flat()));
  return { clients, tools };
});

const ensureUniqueNames = Effect.fn(function* (
  discovered: ReadonlyArray<DiscoveredTool>,
  reservedToolNames: ReadonlyArray<string>,
) {
  const sources = new Map<string, Array<string>>();

  for (const name of reservedToolNames) {
    sources.set(name, ["agent"]);
  }
  for (const { client, definition } of discovered) {
    const current = sources.get(definition.name);
    if (current === undefined) {
      sources.set(definition.name, [client.server]);
    } else {
      current.push(client.server);
    }
  }

  for (const [toolName, toolSources] of sources) {
    if (toolSources.length > 1) {
      return yield* ToolNameConflictError.make({ toolName, sources: toolSources });
    }
  }
});

const makeTool = (definition: McpTool): Tools[string] =>
  Tool.dynamic(definition.name, {
    description: definition.description,
    parameters: definition.inputSchema,
    success: Schema.Unknown,
    failure: Schema.String,
    failureMode: "return",
  });

const makeSystemInstructions = (clients: ReadonlyArray<ConnectedClient>) => {
  const sections = clients.flatMap(({ client, server }) => {
    const instructions = client.getInstructions()?.trim();
    return instructions === undefined || instructions.length === 0
      ? []
      : [`MCP server ${server} instructions:\n${instructions}`];
  });
  return sections.length === 0 ? undefined : sections.join("\n\n");
};

export const make = Effect.fn(function* (
  servers: ReadonlyArray<Server>,
  options?: { readonly reservedToolNames?: ReadonlyArray<string> },
) {
  const parentScope = yield* Scope.Scope;
  const childScope = yield* Scope.fork(parentScope);

  return yield* Effect.gen(function* () {
    const discovered = yield* discover(servers);
    yield* ensureUniqueNames(discovered.tools, options?.reservedToolNames ?? []);

    const tools = discovered.tools.map(({ definition }) => makeTool(definition));
    const toolkit: Toolkit.Toolkit<Tools> = Toolkit.make(...tools);
    const handlers = Object.fromEntries(
      discovered.tools.map(({ client, definition }) => [
        definition.name,
        (parameters: unknown) =>
          decodeParameters(parameters).pipe(
            Effect.mapError((error) => error.message),
            Effect.flatMap((decoded) =>
              callTool(client, definition.name, decoded).pipe(
                Effect.mapError((error) => error.message),
              ),
            ),
          ),
      ]),
    );

    return {
      toolkit,
      layer: toolkit.toLayer(handlers),
      systemInstructions: makeSystemInstructions(discovered.clients),
      close: (exit) => Scope.close(childScope, exit),
    } satisfies ConnectedToolkit;
  }).pipe(
    Effect.provideService(Scope.Scope, childScope),
    Effect.onError((cause) => Scope.close(childScope, Exit.failCause(cause))),
  );
});
