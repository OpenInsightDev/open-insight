---
name: create-package
description: Use when creating a new package under `packages/` in the Open Insight monorepo.
---

# Create Package

Run this first from the repository root:

```bash
vp create vite:library --directory packages/<name>
```

## `package.json`

- Use `catalog:` for workspace-managed dependencies and `workspace:*` for workspace peer dependencies.
- Add the internal alias when needed:

  ```json
  "imports": { "#/*": "./src/*" }
  ```

- Define every public entrypoint explicitly in `exports`, including `./internal` when the package exposes an internal API. Map each source entrypoint to its corresponding published bundle in `publishConfig.exports`.
- Maintain two export maps:
  - `exports`: source `.ts` files for workspace development.
  - `publishConfig.exports`: published `types` and built `import` files.
- Keep `publishConfig.exports` and `vite.config.ts` `pack.entry` synchronized. Export names and generated `.mjs` filenames must match.
- Publish `dist/**/*.mjs`, `dist/**/*.mjs.map`, and `src/**/*.ts` so published type paths resolve to source files.

## `vite.config.ts`

- Import `defineConfig` from `vite-plus`.
- If using `#/*`, enable:

  ```ts
  resolve: {
    tsconfigPaths: true,
  }
  ```

- Configure explicit public entrypoints with:

  ```ts
  pack: {
    entry: {
      index: "src/export.ts",
      internal: "src/index.ts",
    },
    dts: false,
    clean: true,
    sourcemap: true,
    treeshake: true,
    exports: false,
  }
  ```

  Add entries only for actual public APIs.

- Keep type-aware linting enabled with `typeAware: true` and `typeCheck: true`.
- Use `test.include` only when needed to override discovery. The generated template uses `tests/**/*.test.ts`; `core` uses `src/**/*.test.ts`.
- Retain `fmt: {}`.
