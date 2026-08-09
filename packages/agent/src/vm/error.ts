import { Formatter, Schema } from "effect";

/** The script source could not be parsed or compiled into a `vm.Script`. */
export class CompileFailure extends Schema.TaggedError<CompileFailure>(
  "open-insight/VmError/CompileFailure",
)("CompileFailure", {
  filename: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to compile VM script "${this.filename}": ${Formatter.format(this.cause)}`;
  }
}

/** An error was thrown while the compiled script was executing. */
export class RuntimeFailure extends Schema.TaggedError<RuntimeFailure>(
  "open-insight/VmError/RuntimeFailure",
)("RuntimeFailure", {
  filename: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `VM script "${this.filename}" failed at runtime: ${Formatter.format(this.cause)}`;
  }
}

/** Execution did not complete within the configured timeout. */
export class ExecutionTimeout extends Schema.TaggedError<ExecutionTimeout>(
  "open-insight/VmError/ExecutionTimeout",
)("ExecutionTimeout", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `VM script execution timed out: ${Formatter.format(this.cause)}`;
  }
}

/** The object passed as a sandbox was not contextified with `createContext`. */
export class InvalidContext extends Schema.TaggedError<InvalidContext>(
  "open-insight/VmError/InvalidContext",
)("InvalidContext", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Provided object is not a contextified VM sandbox: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([
  CompileFailure,
  RuntimeFailure,
  ExecutionTimeout,
  InvalidContext,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by the VM service. */
export class VmError extends Schema.TaggedError<VmError>("open-insight/VmError")("VmError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static compile = (filename: string, cause: unknown): VmError =>
    VmError.make({ reason: CompileFailure.make({ filename, cause }) });

  static runtime = (filename: string, cause: unknown): VmError =>
    VmError.make({ reason: RuntimeFailure.make({ filename, cause }) });

  static timeout = (cause: unknown): VmError =>
    VmError.make({ reason: ExecutionTimeout.make({ cause }) });

  static invalidContext = (cause: unknown): VmError =>
    VmError.make({ reason: InvalidContext.make({ cause }) });
}
