<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Package Module Organization

Each module must provides `index.ts` for internal exports and `export.ts` for public exports.

### `index.ts`

Internal exports, intended for use within this project or by other modules in the same workspace. 
Exports everything from the module.

### `export.ts`

External exports, intended for package users.
Only exports what package users actually need (core types, functions, classes, etc.).
What is exported from `export.ts` should be carefully curated.
DO NOT excessively export everything from the module.

ONLY two kinds of exports are allowed in `export.ts`:

1. Re-export from submodule's `export.ts` as a namespace export, e.g.
   `export * as Submodule from "./submodule/export.ts"`.
2. Explicitly export, e.g.
   `export { MyType, myFunction } from "./submodule/index.ts"`.

Any other kind of export is forbidden, e.g. `export * from "./submodule/some-file.ts"`.
 