# @open-insight/agent

Effect-based agent provider with sandbox tools, Agent Skills, custom toolkits, and MCP clients.

## Model providers

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
custom Effect HTTP client, compose `openAiLayer(config)` or `openAiCompatLayer(config)` with
`make()` at the program boundary instead.
The constructors load the specified `dotenvPath` internally; pass any `Config` implementation for
`apiKey` and `baseUrl` when configuration should come from another source.

For Anthropic's Messages API, use the matching constructor or model layer. The Anthropic base URL
is the service root (`https://api.anthropic.com`); the client appends `/v1/messages`:

```ts
import { makeAnthropic } from "@open-insight/agent";

const anthropicProgram = Effect.gen(function* () {
  return yield* makeAnthropic({
    apiKey: Config.string("ANTHROPIC_API_KEY"),
    baseUrl: Config.succeed("https://api.anthropic.com"),
    dotenvPath: ".env",
    model: "claude-sonnet-4-5",
  });
});
```

Provider-specific APIs are also grouped under the `Provider` namespace, such as
`Provider.anthropicLayer` and `Provider.openAiLayer`.

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
      maxSteps: 16,
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

To teach the model about command-line tools available in the sandbox, list them under `cli`.
Each entry is either the command string or an options object. On every `runSession`, each CLI's
help page is fetched in parallel and appended to the system prompt:

```ts
const provider =
  yield *
  make({
    cli: [
      "git",
      {
        command: "gh",
        helpArgs: ["-h"], // args used to fetch help, defaults to ["--help"]
        runArgs: ["repo", "view"], // args the agent should always include at runtime
      },
    ],
  });
```

`helpArgs` controls how the help page is fetched (default `--help`), and `runArgs` are documented
in the prompt as the runtime invocation prefix so the agent knows how to call the tool. CLI help
is fetched per session inside the sandbox, so the tools must be available there; a failed fetch
fails the session with a typed `Agent.Error` whose cause is `Cli.HelpError`.

Each `agent.prompt` call runs an agent loop: it streams a model step, executes emitted tools, adds
their results to the session history, and calls the model again until it produces a step without
local tool results. `maxSteps` limits the number of model steps in one prompt and defaults to `32`;
reaching the limit fails the stream instead of returning an incomplete answer. Reuse the same
session for user follow-up turns; it keeps the full conversation and tool-result history.

A provider is safe to reuse for multiple concurrent sessions. Every `runSession(sandbox)` call owns
its conversation history and binds tool execution to that session's sandbox. A session represents
one ordered conversation, so calls to `prompt` on the same session must be made sequentially; there
is no meaningful merge order for concurrent user turns, and the agent does not impose one with a
lock.

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
