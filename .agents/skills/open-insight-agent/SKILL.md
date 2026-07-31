---
name: open-insight-agent
description: Use when building an agent with the @open-insight/agent package. Covers creating Effect-based agent providers, wiring OpenAI, OpenAI-compatible, and Anthropic model providers, adding sandbox tools, loading Agent Skills from a directory, connecting MCP servers, and capturing CLI help as tools.
---

# Open Insight Agent

`@open-insight/agent` builds Effect-based agent providers that run a model loop with sandbox tools, Agent Skills, MCP tools, and CLI tools.

## Creating a provider

`make(config?)` is an `Effect` that builds an `Agent.Provider`.
Provide `LanguageModel.LanguageModel` before running, then call `provider.runSession(sandbox)` with a `Sandbox.Sandbox` to consume the streamed `Agent.StreamPart`s.

Config is optional; pass only the fields you need:

- `toolkit` — an additional `Toolkit.Toolkit` merged with the built-in sandbox toolkit.
- `skills` — a `Skills.Config` for loading Agent Skills from a directory.
- `mcp` — MCP servers whose tools are merged into the agent's toolkit.
- `cli` — CLI definitions whose help output is captured through the sandbox and added to the system instructions.
- `maxSteps` — maximum tool-resolution steps before failing, defaults to `32`.

## Model providers

Construct a provider from Effect `Config` values for `apiKey`, `baseUrl`, `dotenvPath`, and `model`:

```ts
import { makeOpenAi } from "@open-insight/agent";
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

- `makeOpenAi` — OpenAI Responses API.
- `makeOpenAiCompat` — OpenAI-compatible Chat Completions API.
- `makeAnthropic` — Anthropic Messages API; `baseUrl` is the service root and the client appends `/v1/messages`.
- `openAiLayer`, `openAiCompatLayer`, `anthropicLayer` — compose with `make()` when your application supplies a custom Effect HTTP client.
- Constructors load the given `dotenvPath` internally; pass any `Config` implementation when configuration should come from another source.

## Sandbox tools

The built-in sandbox toolkit exposes `Execute`, `ReadFile`, and `WriteFile` tools backed by `Sandbox.Current`.

## Agent Skills

Load Agent Skills from a directory and pass the config as `skills`:

```ts
import { make, Skills } from "@open-insight/agent";

const program = Effect.gen(function* () {
  const provider = yield* make({
    skills: Skills.directory("/path/to/skills"),
  });
  return yield* provider.runSession(sandbox);
});
```

Each skill must be a `SKILL.md` file with closed YAML frontmatter whose `name` matches its directory name.
`make({ skills })` adds the skill descriptions to the system instructions and snapshots the directory into the sandbox at `/opt/open-insight/skills` (override with `Skills.directory(source, { sandboxDirectory })`).

## MCP

Pass MCP servers in `mcp`; their tools are merged into the agent's toolkit and their instructions are appended to the system instructions.

## CLI tools

`cli` entries define commands whose `--help` output is captured through the sandbox and appended to the system instructions.
