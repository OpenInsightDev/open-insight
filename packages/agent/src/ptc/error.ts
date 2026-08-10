/**
 * Error hierarchy for the `ptc` (Programmatic Tool Calling) module.
 *
 * Follows the module error-design conventions: a single wrapper class
 * (`PtcError`) over a tagged union of reason variants, constructed exclusively
 * through `.make()` factories that wrap lower-boundary failures unconditionally.
 */
import { Formatter, Schema } from "effect";

/**
 * The compiled agent script failed the TypeScript type check performed by the
 * `tsgo` compiler. Carries the raw compiler diagnostics so the agent can fix
 * its code.
 */
export class TypeCheckFailed extends Schema.TaggedError<TypeCheckFailed>(
  "open-insight/Ptc/Error/TypeCheckFailed",
)("TypeCheckFailed", {
  script: Schema.String,
  diagnostics: Schema.String,
}) {
  override get message(): string {
    return `Agent script failed type checking:\n${this.diagnostics}`;
  }
}

/**
 * The `tsgo` compiler failed while emitting JavaScript for an otherwise
 * type-clean script (for example because of a configuration or toolchain
 * problem). The raw cause is a defect.
 */
export class CompileFailed extends Schema.TaggedError<CompileFailed>(
  "open-insight/Ptc/Error/CompileFailed",
)("CompileFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Agent script compile failed: ${Formatter.format(this.cause)}`;
  }
}

/**
 * The agent script threw an uncaught error while running inside the sandboxed
 * `node:vm` context. The raw JS error is stored as the defect.
 */
export class RuntimeFailed extends Schema.TaggedError<RuntimeFailed>(
  "open-insight/Ptc/Error/RuntimeFailed",
)("RuntimeFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Agent script failed at runtime: ${Formatter.format(this.cause)}`;
  }
}

/**
 * A tool name that the bridge could not resolve to a real tool in the toolkit.
 */
export class ToolNotFound extends Schema.TaggedError<ToolNotFound>(
  "open-insight/Ptc/Error/ToolNotFound",
)("ToolNotFound", {
  name: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Unknown tool "${this.name}". Available tools: ${this.available.join(", ")}`;
  }
}

/**
 * The underlying tool handler failed in the error channel (a `failureMode:
 * "error"`-style failure) or the handler itself threw. The raw cause is a
 * defect.
 */
export class ToolCallFailed extends Schema.TaggedError<ToolCallFailed>(
  "open-insight/Ptc/Error/ToolCallFailed",
)("ToolCallFailed", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Tool "${this.name}" failed: ${Formatter.format(this.cause)}`;
  }
}

/** The union of every `PtcError` reason variant. */
export const ErrorReason = Schema.Union([
  TypeCheckFailed,
  CompileFailed,
  RuntimeFailed,
  ToolNotFound,
  ToolCallFailed,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/**
 * The wrapper error for the `ptc` module. Discriminate on `reason._tag`.
 */
export class PtcError extends Schema.TaggedError<PtcError>("open-insight/Ptc/Error")("PtcError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static typeCheckFailed = (script: string, diagnostics: string): PtcError =>
    PtcError.make({ reason: TypeCheckFailed.make({ script, diagnostics }) });

  static compileFailed = (cause: unknown): PtcError =>
    PtcError.make({ reason: CompileFailed.make({ cause }) });

  static runtimeFailed = (cause: unknown): PtcError =>
    PtcError.make({ reason: RuntimeFailed.make({ cause }) });

  static toolNotFound = (name: string, available: ReadonlyArray<string>): PtcError =>
    PtcError.make({ reason: ToolNotFound.make({ name, available: [...available] }) });

  static toolCallFailed = (name: string, cause: unknown): PtcError =>
    PtcError.make({ reason: ToolCallFailed.make({ name, cause }) });
}
