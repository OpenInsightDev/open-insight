import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Exit, Layer, Schema, Scope } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { Server } from "./config.ts";
import { callTool, connectScoped, listTools, type Connection } from "./client.ts";
import { ToolConflict } from "./error.ts";

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

export type Runtime = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  layer: Layer.Layer<Tool.HandlersFor<Tools>>;
  systemInstructions?: string;
  close: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>;
}>;

type Discovered = Readonly<{
  client: Connection;
  definition: McpTool;
}>;

const decode = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));

const discover = Effect.fn(function* (servers: ReadonlyArray<Server>) {
  const clients = yield* Effect.forEach(servers, connectScoped);
  const tools = yield* Effect.forEach(clients, (client) =>
    listTools(client).pipe(
      Effect.map((tools) => tools.map((definition) => ({ client, definition }))),
    ),
  ).pipe(Effect.map((groups) => groups.flat()));
  return { clients, tools };
});

const checkNames = Effect.fn(function* (
  discovered: ReadonlyArray<Discovered>,
  reserved: ReadonlyArray<string>,
) {
  const sources = new Map<string, Array<string>>();

  for (const name of reserved) {
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

  for (const [toolName, origins] of sources) {
    if (origins.length > 1) {
      return yield* ToolConflict.make({ toolName, sources: origins });
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

const instructions = (clients: ReadonlyArray<Connection>) => {
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
  options?: { readonly reservedNames?: ReadonlyArray<string> },
) {
  const parent = yield* Scope.Scope;
  const child = yield* Scope.fork(parent);

  return yield* Effect.gen(function* () {
    const discovered = yield* discover(servers);
    yield* checkNames(discovered.tools, options?.reservedNames ?? []);

    const tools = discovered.tools.map(({ definition }) => makeTool(definition));
    const toolkit: Toolkit.Toolkit<Tools> = Toolkit.make(...tools);
    const handlers = Object.fromEntries(
      discovered.tools.map(({ client, definition }) => [
        definition.name,
        (parameters: unknown) =>
          decode(parameters).pipe(
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
      systemInstructions: instructions(discovered.clients),
      close: (exit) => Scope.close(child, exit),
    } satisfies Runtime;
  }).pipe(
    Effect.provideService(Scope.Scope, child),
    Effect.onError((cause) => Scope.close(child, Exit.failCause(cause))),
  );
});
