# @open-insight/agent

Effect-based agent provider with sandbox tools, Agent Skills, custom toolkits, and MCP clients.

## OpenAI providers

Create a base agent provider for the OpenAI Responses API from an API key, base URL, and model name:

```ts
import { makeOpenAi, makeOpenAiCompat } from "@open-insight/agent";
import { Config, Effect } from "effect";

const program = Effect.gen(function* () {
  const provider = yield* makeOpenAi({
    apiKey: Config.string("OPENAI_API_KEY"),
    baseUrl: Config.string("OPENAI_BASE_URL"),
    dotenvPath: ".env",
    model: "example-model",
  });
  return yield* provider.runSession(sandbox);
});
```

For providers that implement the OpenAI-compatible Chat Completions API, use the same three values
with `makeOpenAiCompat`:

```ts
const compatProgram = Effect.gen(function* () {
  return yield* makeOpenAiCompat({
    apiKey: Config.string("DEEPSEEK_API_KEY"),
    baseUrl: Config.string("DEEPSEEK_BASE_URL"),
    dotenvPath: ".env",
    model: "deepseek-chat",
  });
});
```

Both constructors use the runtime's global `fetch` implementation. For applications that supply a
custom Effect HTTP client, compose `openAiLanguageModelLayer(config)` or
`openAiCompatLanguageModelLayer(config)` with `make()` at the program boundary instead.
The constructors load the specified `dotenvPath` internally; pass any `Config` implementation for
`apiKey` and `baseUrl` when configuration should come from another source.

## Configuration

All optional capabilities are composed through one `make` call:

```ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Mcp, Skills, make } from "@open-insight/agent";
import { Effect, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";

const program = Effect.scoped(
  Effect.gen(function* () {
    const provider = yield* make({
      toolkit: customToolkit,
      skills: Skills.directory("./skills"),
      mcp: [
        Mcp.stdio({
          name: "local-tools",
          command: "node",
          args: ["./mcp-server.mjs"],
        }),
        Mcp.http({
          name: "remote-tools",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" },
        }),
      ],
    });
    const agent = yield* provider.runSession(sandbox);
    return yield* agent.prompt(Prompt.make("Inspect the project")).pipe(Stream.runCollect);
  }),
).pipe(Effect.provide(NodeServices.layer));
```

MCP connections are scoped resources, so construct and use the provider inside `Effect.scoped`
or a scoped layer. Configuring a skills directory requires `FileSystem` and `Path`; in Node.js,
provide `NodeServices.layer`. Skill files are copied into the sandbox snapshot and advertised to
the model for progressive loading.

Each `agent.prompt` call performs one model turn and resolves the tool calls emitted in that turn.
Reuse the same session for follow-up turns when a workflow needs additional model decisions; the
session keeps the full conversation and tool-result history.

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
