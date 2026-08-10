# PTC — Programmatic Tool Calling

This module implements the design described in `AGENTS.md`: instead of an LLM
emitting tool calls, the **agent writes TypeScript code** that calls an SDK
whose surface is derived from the real tool schemas. A compatibility layer
routes those SDK calls back to the actual tool implementations.

## High-level flow

```
[Toolkit.WithHandler<Tools>]
        │  (real, handled Effect AI tools)
        ▼
  ToolSpecs  (schema + description per tool)
        │
        ▼  generate()
  SDK assets:  sdk.d.ts (types/documentation) + sdk.mjs (runtime)
        │
        ├──► seed() into the in-memory FS  (the agent's working environment)
        │
        └──► run(script):
               tsgo --noEmit      → TypeCheckFailed on bad types
               tsgo emit          → compiled JS (type-stripped)
               node:vm (isolated) → script runs; calls go through __ptc bridge
                    └──► routes back to the real toolkit tool handler
```

## Module layout (`packages/agent/src/ptc/`)

| File         | Responsibility                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `error.ts`   | `PtcError` wrapper + reason union (error-design conventions).                                                                                                |
| `dts.ts`     | Reuses the pre-existing `jsonSchemaToDts` (JSON Schema → TS `.d.ts`).                                                                                        |
| `schema.ts`  | `toSpec` / `specsOf`: lower `Tool`s → `ToolSpec` (name, description, failureMode, parameter/success/failure JSON Schemas).                                   |
| `sdk.ts`     | `generate`: turn `ToolSpec`s into `sdk.d.ts` + `sdk.mjs` (`SdkAssets`).                                                                                      |
| `bridge.ts`  | `Bridge` service + `make`/`layer`. The VM-facing `__ptc(name, args)`; dispatches to `Toolkit.handle`, normalises to `{ ok, value } \| { ok: false, error }`. |
| `runner.ts`  | `typecheck`, `compile`, `run` + `Runner` service.                                                                                                            |
| `service.ts` | `Ptc` service: `sdk()`, `seed(fs)`, `run(script)`.                                                                                                           |

## Design decisions

### 1. Tools are modelled from `Tool` internals, not re-declared

`Tool` already exposes `name`, `description`, `failureMode`,
`parametersSchema`, `successSchema`, `failureSchema`. We derive `ToolSpec`s
from these (`Tool.getJsonSchema` / `Tool.getJsonSchemaFromSchema`) so the SDK
never drifts from the actual tool definitions. **Decision:** one source of
truth — the Effect AI `Tool`.

### 2. The SDK is global functions, not importable modules

The agent script runs in `node:vm` **script** mode, where `import`/`export` are
not allowed. So the generated surface is **globals**: every tool becomes
`async function Name(args): Promise<CallResult<...>>`. `sdk.d.ts` declares them
inside `declare global {}`, and `sdk.mjs` installs them at runtime. The dts is
both the agent's documentation and the contract tsgo validates against.

### 3. Call result shape: a discriminated union

Each SDK call resolves to `{ ok: true, value } | { ok: false, error }`
(`CallResult<S>`). This keeps sandboxed agent code robust: it branches on
`.ok` and never sees host-side `AiError`/thrown exceptions.

### 4. Type fidelity: `UndefinedOr` is (faithfully) required

Effect's `Schema.UndefinedOr` emits a property that is _required_ in the JSON
Schema (key must be present, value may be `undefined|null`), and the runtime
decode enforces that. I initially "relaxed" these to optional to be ergonomic,
but discovered the actual `Toolkit.handle` decode **rejects** a missing key, so
relaxation would make the types _more permissive_ than runtime. **It was
reverted** — the generated types stay faithful to the real tool contract.
(Tool: `Execute` requires `env`.)

### 5. Compilation with the real `tsgo`

The `typescript` package's `lib/tsc.js` spawns the native tsgo binary and
propagates its exit code. The runner:

- **Type-checks** with `tsc -p tsconfig.json`. Exit != 0 ⇒ `TypeCheckFailed`
  with the diagnostics.
- **Compiles** to `agent.js` (tsgo type-strips; no enums/namespaces are used,
  so stripping is complete).

Because the script is a plain `async function main` under the `main` contract,
it type-checks as a Script and emits clean JS — no `moduleDetection: force` and
no `export {}` handling are needed.

### 6. Scratch dir for the compiler, memfs for the environment

`tsgo` is a native binary that reads the real disk. The agent's logical
"in-memory environment" is memfs (the `seed` target), but compilation runs in a
transient OS temp dir (`~/tmp`-like), scoped and auto-deleted
(`Effect.acquireRelease` + `Effect.scoped`). The memfs↔compiler boundary is a
documented compromise: memfs is the visible/durable environment; the scratch
dir is an internal, transient artifact.

### 7. A well-defined `main` contract, run via vm's own mechanism

Rather than parsing or rewriting the agent's source, the runner defines a clear
**script contract** and lets `node:vm` do the work:

- The agent writes a single **`async function main`**; all tool calls happen
  inside it (ordinary `await`, no top-level `await` or module syntax).
- The runner evaluates the script once (`vm.runInContext`), which declares
  `main`; it then invokes `main()` (`vm.runInContext("main()", ctx)`) — the
  completion value is the resulting Promise, which the runner awaits.

Because `main` is an `async function`, the value of `main()` is vm's native
completion value — **no string wrapping, no last-expression scanner, no
`export {}` stripping**. The compile step therefore also no longer needs
`moduleDetection: force` (a plain Script emits clean JS). The contract is
surfaced to the agent in the generated `sdk.d.ts` header.

### 8. The bridge is a single `__ptc` global

`sdk.mjs` defines `const call = globalThis.__ptc` and each tool function calls
`call(toolName, args)`. The host injects `__ptc = bridge.vmCall`, a plain async
function that runs the corresponding `Toolkit.WithHandler.handle(name, args)`
and returns the structured result. This mapping of "SDK API → real tool call"
is the compatibility layer described in AGENTS.md.

### 9. Services & layering pitfalls

- **No `import type` for a value used at runtime** (`PtcError` is called).
- **`yield* Service` yields the _shape_**, not the branded class —
  `Context.Service.Shape<T>` resolved to `never` here, so methods that need the
  vm are typed with the `Vm` _requirement_ rather than by passing the shape.
- **`Layer.provide` only satisfies a layer's own build**; it does **not**
  re-expose the provided services. Hence `Ptc.layer` provides only `Ptc`, and
  callers supply `Vm.layer` (required by the `run` pipeline) explicitly. This
  avoids the "Service not found" failure and is explicit.

## MCP & Skills (from AGENTS.md)

These are downstream integration points, not implemented here:

- **MCP**: MCP tools must live inside the sandbox, so the sandbox should expose
  a port to reverse-proxy MCP tools. The `Bridge` is designed to dispatch to
  any tool by name, so MCP-sourced tools can be merged into the same toolkit
  and exposed identically.
- **Skills**: copied into the sandbox `~/.agents/skills` (out of scope here).

## Testing

- `src/ptc/sdk.test.ts` — SDK generation (dts/runtime/layout/types).
- `tests/ptc.e2e.test.ts` — end-to-end: real sandbox toolkit (Execute /
  ReadFile / WriteFile) behind an in-memory fake `Sandbox.Current`; verifies
  type-check → compile → run → tool routing, `TypeCheckFailed`,
  `ToolNotFound`, and `seed`.
