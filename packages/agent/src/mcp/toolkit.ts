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
}>;

type DiscoveredTool = Readonly<{
  client: ConnectedClient;
  definition: McpTool;
}>;

const decodeParameters = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));

const discover = Effect.fn(function* (servers: ReadonlyArray<Server>) {
  const clients = yield* Effect.forEach(servers, connectScoped);
  return yield* Effect.forEach(clients, (client) =>
    listTools(client).pipe(
      Effect.map((tools) => tools.map((definition) => ({ client, definition }))),
    ),
  ).pipe(Effect.map((groups) => groups.flat()));
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

export const make = Effect.fn(function* (
  servers: ReadonlyArray<Server>,
  options?: { readonly reservedToolNames?: ReadonlyArray<string> },
) {
  const parentScope = yield* Scope.Scope;
  const childScope = yield* Scope.fork(parentScope);

  return yield* Effect.gen(function* () {
    const discovered = yield* discover(servers);
    yield* ensureUniqueNames(discovered, options?.reservedToolNames ?? []);

    const tools = discovered.map(({ definition }) => makeTool(definition));
    const toolkit: Toolkit.Toolkit<Tools> = Toolkit.make(...tools);
    const handlers = Object.fromEntries(
      discovered.map(({ client, definition }) => [
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
    } satisfies ConnectedToolkit;
  }).pipe(
    Effect.provideService(Scope.Scope, childScope),
    Effect.onError((cause) => Scope.close(childScope, Exit.failCause(cause))),
  );
});
