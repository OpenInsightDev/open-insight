# AGENTS.md

## Package Module Organization

Each module must provides `index.ts` for internal exports and `export.ts` for public exports.

### `index.ts`

Internal exports, intended for use within this project or by other modules in the same workspace.
Exports (basically) everything from the module.

### `export.ts`

External exports, intended for package users.
Only exports what package users actually need (core types, functions, classes, etc.).
What is exported from `export.ts` should be carefully curated.
DO NOT excessively export everything from the module.

ONLY 4 kinds of exports are allowed in `export.ts`:

1. Re-export from submodule's `export.ts` as a namespace export, e.g.
   `export * as Submodule from "./submodule/export.ts"`.
2. Explicitly export, e.g.
   `export { MyType, myFunction } from "./submodule/index.ts"`.
3. Internal export (MUST): `export * as Internal from "./index.ts"`.
4. Re-export from external packages, e.g. `export * from "@open-insight/core"`

Any other kind of export is forbidden, e.g. `export * from "./submodule/some-file.ts"`.

### Export Synchronization

After modifying any module code, ALWAYS check whether the exports in `export.ts` need to be synchronized (added / removed / corrected).
The exports must always match the current state of the code.
