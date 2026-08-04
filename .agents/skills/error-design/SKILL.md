---
name: error-design
description: Design conventions for module error hierarchies with Effect. Use when creating, refactoring, or reviewing a module's Error classes — tagged union design, Schema.TaggedErrorClass usage, factory construction, exports. Follows the official Effect SqlError pattern.
---

# Error Design

## Pattern

One wrapper class over a tagged union of reason variants:

```ts
import { Schema } from "effect";

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

1. Wrapper named `XxxError`, never `Error`. Suffix applies to the wrapper only; variants keep descriptive names (`ProviderNotAvailable`). Don't rename variants to add `Error` — the class name is the `_tag`, a public contract (`catchTag`, tests).
2. Identifier `"org/Module/Error/Variant"` (namespaced); tag without module prefix (`"ConnectionError"`, not `"ModuleConnectionError"`).
3. Construct with `.make()`, never `new`.
4. Factories always wrap — no idempotency in error.ts. Causes come from lower boundaries (`PlatformError`, `new Error(...)`), so an already-wrapped cause rarely occurs; don't add the check speculatively. If a call site can genuinely receive an already-wrapped error, check there:
   ```ts
   catch: (cause) => (cause instanceof SqlError ? cause : SqlError.connect(cause)),
   ```
   Nested wrappers: both factories stay unconditional. An inner factory that "handles" already-wrapped values violates this rule — remove its check, don't mirror it outside.
5. Optional fields: `Schema.optionalKey(...)`, not `Schema.optional(...)`.
6. Export wrapper, all variants, and the union. Also check the package root: a namespace re-export (`export * as Sandbox`) blocks direct imports — add `export { SandboxError }` there.
7. No `any`, no `as`. Causes: `Schema.Defect()` stored raw — but never decode a Defect, `decodeUnknownSync` throws `Expected JSON value` (raw storage works only because `.make()` skips validation). Use `Schema.Error()` + `decodeUnknownSync` when the getter needs `cause.message` — `Formatter.format` renders `"Error: boom"`, not the bare message.
8. `_tag` is for discrimination; the namespaced identifier owns collision avoidance.
