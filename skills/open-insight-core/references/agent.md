# Agent

`Agent.ProviderService` opens an agent session for a `Sandbox.Sandbox`. Agent
providers own their runtime integration; toolkits are not part of this contract.

```ts
const provider = yield* Agent.ProviderService;
const agent = yield* provider.runSession(sandbox);
```

An `Agent` exposes:

- `trajectory`, a `Ref.Ref<Prompt.Trajectory>` containing the prompts and
  responses streamed through this session;
- `prompt(prompt)`, a `Stream<Response.StreamPartEncoded, AgentError>`.

`Agent.make` adapts a provider-specific session implementation to this public
contract. It serializes prompts within each session and appends every completed
response to `trajectory`. `Agent.layerFrom` installs the resulting provider as
`Agent.ProviderService`.

Providers may declare a `snapshotExtension` containing snapshot instructions and
an optional context. Harnesses apply this extension before starting a sandbox.
