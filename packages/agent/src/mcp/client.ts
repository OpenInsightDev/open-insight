import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Match } from "effect";
import type { Server } from "./config.ts";
import { ClientError } from "./error.ts";

export type ConnectedClient = Readonly<{
  server: string;
  client: Client;
}>;

const clientError = (server: string, operation: string) => (cause: unknown) =>
  ClientError.make({ server, operation, cause });

const makeUrl = (server: string, url: string) =>
  Effect.try({
    try: () => new URL(url),
    catch: clientError(server, "create-transport"),
  });

const makeTransport = (server: Server) =>
  Match.value(server).pipe(
    Match.tag("Custom", ({ transport }) => Effect.succeed(transport)),
    Match.tag("Stdio", (server) =>
      Effect.try({
        try: () =>
          new StdioClientTransport({
            command: server.command,
            args: server.args === undefined ? undefined : Array.from(server.args),
            cwd: server.cwd,
            env: server.env === undefined ? undefined : { ...server.env },
          }),
        catch: clientError(server.name, "create-transport"),
      }),
    ),
    Match.tag("Http", (server) =>
      makeUrl(server.name, server.url).pipe(
        Effect.flatMap((url) =>
          Effect.try({
            try: () =>
              new StreamableHTTPClientTransport(url, {
                requestInit:
                  server.headers === undefined ? undefined : { headers: { ...server.headers } },
              }),
            catch: clientError(server.name, "create-transport"),
          }),
        ),
      ),
    ),
    Match.exhaustive,
  );

const close = (server: string, client: Client) =>
  Effect.tryPromise({
    try: () => client.close(),
    catch: clientError(server, "close"),
  }).pipe(Effect.ignore({ log: "Warn", message: `Failed to close MCP server ${server}` }));

export const connectScoped = Effect.fn(function* (server: Server) {
  const transport: Transport = yield* makeTransport(server);
  const client = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new Client({ name: "open-insight-agent", version: "0.0.0" }),
      catch: clientError(server.name, "create-client"),
    }),
    (client) => close(server.name, client),
  );

  yield* Effect.tryPromise({
    try: () => client.connect(transport),
    catch: clientError(server.name, "connect"),
  });

  return { server: server.name, client } satisfies ConnectedClient;
});

export const listTools = Effect.fn(function* ({ client, server }: ConnectedClient) {
  const tools: Array<McpTool> = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = yield* Effect.tryPromise({
      try: () => client.listTools(cursor === undefined ? undefined : { cursor }),
      catch: clientError(server, "list-tools"),
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;

    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) {
        return yield* ClientError.make({
          server,
          operation: "list-tools",
          cause: new Error(`MCP server repeated pagination cursor ${cursor}`),
        });
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);

  return tools;
});

export const callTool = (
  { client, server }: ConnectedClient,
  name: string,
  parameters: Record<string, unknown>,
) =>
  Effect.tryPromise({
    try: () => client.callTool({ name, arguments: parameters }),
    catch: clientError(server, `call-tool:${name}`),
  });
