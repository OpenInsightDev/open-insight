---
name: error-design
description: Design conventions for module error hierarchies with Effect. Use when creating, refactoring, or reviewing a module's Error classes — tagged union design, Schema.TaggedErrorClass usage, factory construction, exports. Follows the official Effect SqlError pattern.
---

# Error Design

## Pattern

One wrapper class over a tagged union of reason variants:

```ts
import { Formatter, Schema } from "effect";

export class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>(
  "effect/sql/SqlError/ConnectionError", // identifier → instance name, namespaced
)("ConnectionError", {                   // tag → _tag, no module prefix
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Connection failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([ConnectionError, QueryError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class SqlError extends Schema.TaggedErrorClass<SqlError>("effect/sql/SqlError")(
  "SqlError",
  { reason: ErrorReason },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static connect = (cause: unknown): SqlError =>
    SqlError.make({ reason: ConnectionError.make({ cause }) });
}
```

## Rules

1. Wrapper named `XxxError`, never `Error`. Suffix applies to the wrapper only; variants keep descriptive names (`ProviderNotAvailable`). Don't rename variants to add `Error` — the class name is the `_tag`, a public contract (`catchTag`, tests). A verb-phrase name is already complete: `InstructionUnsupported`, not `InstructionUnsupportedError`.
2. Identifier `"org/Module/Error/Variant"` (namespaced); tag without module prefix (`"ConnectionError"`, not `"ModuleConnectionError"`).
3. Construct with `.make()`, never `new`.
4. Factories always wrap — no idempotency in error.ts. Causes come from lower boundaries (`PlatformError`, `new Error(...)`), so an already-wrapped cause rarely occurs; don't add the check speculatively. If a call site can genuinely receive an already-wrapped error, check there:
   ```ts
   catch: (cause) => (cause instanceof SqlError ? cause : SqlError.connect(cause)),
   ```
   Nested wrappers: both factories stay unconditional. An inner factory that "handles" already-wrapped values violates this rule — remove its check, don't mirror it outside.
5. Optional fields: `Schema.optionalKey(...)`, not `Schema.optional(...)`.
6. Export wrapper, all variants, and the union. Also check the package root: a namespace re-export (`export * as Sandbox`) blocks direct imports — add `export { SandboxError }` there.
7. No `any`, no `as`. Causes are stored raw as `Schema.Defect()` and read only via `Formatter.format`:
   ```ts
   cause: Schema.Defect(),
   // ...
   override get message(): string {
     return `Connection failed: ${Formatter.format(this.cause)}`;
   }
   ```
   Never decode a Defect — `decodeUnknownSync` throws `Expected JSON value` (raw storage works only because `.make()` skips validation). There is no valid `Schema.Error()` + `decodeUnknownSync` usage in a rewritten module; that is the legacy pattern and must be removed, not kept. `Formatter.format` renders `"Error: boom"`, not the bare message — that is the accepted rendering.
8. `_tag` is for discrimination; the namespaced identifier owns collision avoidance.
9. "Rewrite" means replace the whole error module — no legacy remnants survive. A rewritten error.ts contains none of the following (`rg` each against the module returns nothing):
   - `Schema.Error()` / `Schema.decodeUnknownSync(...)` — causes are `Schema.Defect()` stored raw, read via `Formatter.format`
   - `mapUnknownError` — factories wrap unconditionally with `.make()`
   - `new XxxError(...)` — construction only via `.make()`
   - `TaggedErrorClass<X>()("X", ...)` with an empty identifier — every class takes a namespaced identifier
   - `Schema.optional(` — use `Schema.optionalKey(`
   - a wrapper class named `Error` — it is `XxxError`
   - variant names ending in `Error` — the suffix belongs to the wrapper only

## Checklist

Verify each item against the finished module before considering the work done. Each item is mandatory; a single miss means the module does not conform.

- [ ] Wrapper class is named `XxxError` (e.g. `TasksError`), never `Error`; tag equals the class name (`"TasksError"`).
- [ ] Variants are descriptive names without the `Error` suffix (`InvalidTask`, `InitFailed`), never `XxxError`-style names; no variant was renamed to add or keep `Error`.
- [ ] Every class (wrapper and variants) carries a namespaced identifier `"org/Module/Error/Variant"` / `"org/Module/Error"` as its first argument.
- [ ] Tags carry no module prefix (`"ConnectionError"`, not `"ModuleConnectionError"`).
- [ ] No `new XxxError(...)` anywhere in the module — all construction goes through `.make()`.
- [ ] Factories wrap unconditionally: `static source = (cause: unknown) => XxxError.make({ reason: Variant.make({ cause }) })`. No idempotency / `instanceof` short-circuit inside error.ts.
- [ ] If a call site can genuinely receive an already-wrapped error, the `instanceof` guard lives there, not in the factory.
- [ ] No `Schema.optional(...)` — optional fields use `Schema.optionalKey(...)` (skip if no optional fields).
- [ ] error.ts exports the wrapper, every variant, and the `ErrorReason` union (and its type).
- [ ] Module index re-exports `./error.ts` (e.g. `export * from "./error.ts"`).
- [ ] Package root: any namespace re-export (`export * as X`) of this module is paired with a direct `export { XxxError }` so the wrapper stays importable.
- [ ] No `any`, no `as` anywhere in error.ts.
- [ ] Causes are stored raw (`Schema.Defect()`) and read only via `Formatter.format`; a `Defect` is never decoded, and no `Schema.Error()` / `decodeUnknownSync` remains.
- [ ] Rewrite completeness: `rg` for legacy remnants (`Schema.Error()`, `decodeUnknownSync`, `mapUnknownError`, `new XxxError(`, empty `TaggedErrorClass<X>()(`) inside the module's error.ts returns nothing.
- [ ] All `catchTag(...)` / test references use the final `_tag` values after any rename; `rg` for the old names returns nothing outside the diff.
