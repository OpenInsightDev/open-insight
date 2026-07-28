# @open-insight/agent

Effect-based agent provider with sandbox tools, Agent Skills, custom toolkits, and MCP clients.

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
