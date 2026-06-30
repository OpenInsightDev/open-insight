---
name: migrate-deno-open-insight
description: Project-specific guide for migrating one module at a time from references/open-insight.deno into this Vite+ pnpm workspace. Use when moving a single @open-insight Deno package or app module and needing exact rules for package layout, mod.ts/export.ts handling, "@/..." import rewrites, Deno/JSR dependency decisions, and Vite+ validation.
---

# Migrate Deno Open Insight

Migrate one Deno module at a time. Do not generate broad migration scripts, copy the whole old monorepo, or add compatibility shims to force ambiguous code to work. If a runtime dependency or app model has no clear Node/Vite+ target, stop and report the exact blockage.

## Module Boundary

Treat a Deno package directory as the normal migration unit:

- `references/open-insight.deno/packages/core`
- `references/open-insight.deno/packages/eval`
- `references/open-insight.deno/packages/utils`
- `references/open-insight.deno/packages/sandbox-deno`
- one of the other `packages/sandbox-*`, `agent-codex`, or `rl` packages

Migrate benchmark apps only after their imported package, usually `@open-insight/eval`, builds. Do not migrate `apps/dashboard` as a direct replacement for `apps/website`; the old dashboard is Fresh/Preact with server routes, while the current app is plain Vite.

Ignore old project infrastructure: `.git`, `.repos`, `node_modules`, `deno.lock`, `skills-lock.json`, and `apps/dashboard/@open-insight/dashboard`.

## Target Layout

Place a migrated package under `packages/<name>/src`, following the existing Vite+ package shape in `packages/utils`.

Preserve source structure inside the module, with these file-name rules:

- Deno `mod.ts` becomes `index.ts` in the same directory.
- Deno `export.ts` stays `export.ts`.
- Other source files keep their names.
- Tests stay next to the migrated source, but Deno-runtime tests must be rewritten before enabling them.

Map Deno package exports exactly:

- If `deno.json` has `"exports": "./mod.ts"`, package `"."` should point at the built `src/index.ts` entry.
- If `deno.json` has `"exports": { ".": "./export.ts", "./internal": "./mod.ts" }`, package `"."` should point at the built `src/export.ts` entry and `"./internal"` should point at the built `src/index.ts` entry.

For example, old `@open-insight/core` and `@open-insight/eval` have public `export.ts` plus internal `mod.ts`; after migration they should expose public `./dist/export.mjs` and internal `./dist/index.mjs`. Old `@open-insight/utils`, `@open-insight/rl`, `@open-insight/agent-codex`, `sandbox-apple`, and `sandbox-smolvm` only expose `mod.ts`, so their public entry is `src/index.ts`.

Rename the current `packages/utils` package from `"utils"` to `"@open-insight/utils"` before migrating modules that import `@open-insight/utils`.

## Import Rewrites

Keep `.ts` extensions in source imports; this repo already enables `allowImportingTsExtensions`.

Apply these rewrites inside the migrated module:

- Any relative import/export ending in `/mod.ts` becomes `/index.ts`.
- Any same-directory `./mod.ts` becomes `./index.ts`.
- Any `../mod.ts` becomes `../index.ts`.
- `export.ts` imports remain `export.ts`; do not rename them to `index.ts`.

Rewrite Deno package-local aliases from `@/` to relative paths within that package:

- In `core`, `@/agent/...` targets `packages/core/src/agent/...` and `@/sandbox/...` targets `packages/core/src/sandbox/...`.
- In `eval`, `@/benchmark/...`, `@/exec/...`, `@/harness/...`, `@/matrix/...`, `@/metric/...`, `@/task/...`, and `@/utils/...` target the matching directories under `packages/eval/src`.
- If the alias target was `mod.ts`, point to `index.ts` after renaming.

Keep cross-package imports as package imports. Do not rewrite these to relative paths:

- `@open-insight/core`
- `@open-insight/core/internal`
- `@open-insight/utils`
- `@open-insight/eval`

Make package `exports` satisfy those imports instead.

## Dependencies

Read the module's own `deno.json` and root `references/open-insight.deno/deno.json`; add only dependencies that the migrated source still imports.

Use these actual source facts:

- `utils` imports `effect` and Effect unstable process modules.
- `core` imports `effect`, `@effect/platform-node`, `ai`, `dockerfile-ast`, `just-bash`, and `tree-sitter-containerfile`.
- `eval` imports `effect`, `@effect/platform-node`, `@agentclientprotocol/sdk`, `ai`, `immer`, and `picomatch`; `@types/picomatch` is dev-only.
- `agent-codex` imports `@openai/codex-sdk`.
- `sandbox-daytona` imports `@daytona/sdk`.
- `sandbox-e2b` imports `e2b`.
- `sandbox-deno` imports `@deno/sandbox` from JSR.

Do not add old Deno-only dependencies just because they appear in `deno.json`. `@std/assert` is only for Deno tests. `@std/fs`, `@std/toml`, and `@deno/vite-plugin` are not used by the migrated package source unless an import remains after rewrites.

For `@deno/sandbox`, first try the pnpm JSR alias form for the real dependency. If Vite+/pnpm cannot install it, stop and ask whether to omit `sandbox-deno`, vendor a resolved package, or replace that provider. Do not fake the module.

## Deno Runtime APIs

Distinguish the Deno global from the `@deno/sandbox` namespace:

- `import * as Deno from "@deno/sandbox"` in `sandbox-deno` is a client library namespace; keep it if the dependency installs.
- `Deno.makeTempDir`, `Deno.remove`, `Deno.listen`, `Deno.writeTextFile`, `Deno.readTextFile`, and `Deno.Command` are Deno runtime APIs; rewrite them to Node APIs before enabling those files or tests.

Known Deno-runtime usage is in `packages/core/sandbox/provider/builtin/docker/mod.test.ts`. Rewrite that test before counting it as migrated.

## Dashboard And Apps

For benchmark apps, migrate the app only as a thin Node CLI module after `@open-insight/eval` is working. It should depend on `@open-insight/eval` rather than copying eval internals.

For the old dashboard:

- UI-only migration means porting JSX/styles into `apps/website/src` and removing Fresh concepts: `routes`, `islands`, `Head`, `createDefine`, `fresh`, `@fresh/plugin-vite`, and `deno serve`.
- Server-route migration is a design decision. Plain Vite cannot host `routes/api/[name].tsx`; ask before adding a server framework.

## Validation

After each module migration, run the Vite+ checks for that package first, then the workspace checks. Before calling the module migrated, confirm:

- no `@/` imports remain inside migrated `packages/core/src` or `packages/eval/src`
- no source import still points to `/mod.ts`
- no `jsr:` or `npm:` specifier remains in TypeScript imports
- no old Fresh imports appear outside an intentional dashboard migration
- no Deno runtime global remains in enabled Node/Vite+ source or tests
