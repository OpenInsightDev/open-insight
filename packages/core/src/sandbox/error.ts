import { Formatter, Schema } from "effect";
import { Assertion } from "../assert/index.ts";
import * as Snapshot from "../snapshot/index.ts";

export class ProviderNotAvailableError extends Schema.TaggedErrorClass<ProviderNotAvailableError>(
  "open-insight/SandboxError/ProviderNotAvailableError",
)("ProviderNotAvailableError", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Sandbox provider "${this.name}" is not available: ${Formatter.format(this.cause)}`;
  }
}

export class SandboxStartError extends Schema.TaggedErrorClass<SandboxStartError>(
  "open-insight/SandboxError/SandboxStartError",
)("SandboxStartError", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to start sandbox "${this.name}": ${Formatter.format(this.cause)}`;
  }
}

export class SandboxExecError extends Schema.TaggedErrorClass<SandboxExecError>(
  "open-insight/SandboxError/SandboxExecError",
)("SandboxExecError", {
  name: Schema.String,
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Sandbox "${this.name}" failed during ${this.operation}: ${Formatter.format(this.cause)}`;
  }
}

export class SandboxExposeError extends Schema.TaggedErrorClass<SandboxExposeError>(
  "open-insight/SandboxError/SandboxExposeError",
)("SandboxExposeError", {
  name: Schema.String,
  sandboxPort: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to expose port ${this.sandboxPort} from sandbox "${this.name}": ${Formatter.format(this.cause)}`;
  }
}

export class SnapshotBuildUnsupported extends Schema.TaggedErrorClass<SnapshotBuildUnsupported>(
  "open-insight/SandboxError/SnapshotBuildUnsupported",
)("SnapshotBuildUnsupported", {
  name: Schema.String,
  snapshot: Snapshot.ContainerfileSnapshot,
}) {
  override get message(): string {
    return `Sandbox provider "${this.name}" does not support Containerfile snapshots`;
  }
}

export class AssertionFailure extends Schema.Class<AssertionFailure>(
  "open-insight/SandboxError/AssertionFailure",
)({
  assertion: Assertion,
  message: Schema.String,
  expected: Schema.optionalKey(Schema.String),
  actual: Schema.optionalKey(Schema.String),
}) {}

export class AssertionError extends Schema.TaggedErrorClass<AssertionError>(
  "open-insight/SandboxError/AssertionError",
)("AssertionError", {
  failures: Schema.Array(AssertionFailure),
}) {
  override get message(): string {
    return this.failures.length === 1
      ? `Sandbox assertion failed: ${this.failures[0].message}`
      : `${this.failures.length} sandbox assertions failed`;
  }
}

export const ErrorReason = Schema.Union([
  Snapshot.SnapshotError,
  ProviderNotAvailableError,
  SandboxStartError,
  SandboxExecError,
  SandboxExposeError,
  SnapshotBuildUnsupported,
  AssertionError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class SandboxError extends Schema.TaggedErrorClass<SandboxError>(
  "open-insight/SandboxError",
)("SandboxError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static provider =
    (name: string) =>
    (cause: unknown): SandboxError =>
      SandboxError.make({ reason: ProviderNotAvailableError.make({ name, cause }) });

  static snapshot =
    (mapper: (cause: unknown) => Snapshot.SnapshotError) =>
    (cause: unknown): SandboxError =>
      SandboxError.make({ reason: mapper(cause) });

  static buildUnsupported = (
    name: string,
    snapshot: Snapshot.ContainerfileSnapshot,
  ): SandboxError =>
    SandboxError.make({ reason: SnapshotBuildUnsupported.make({ name, snapshot }) });

  static sandboxStart =
    (name: string) =>
    (cause: unknown): SandboxError =>
      SandboxError.make({ reason: SandboxStartError.make({ name, cause }) });

  static sandboxExec =
    (name: string, operation: string) =>
    (cause: unknown): SandboxError =>
      SandboxError.make({ reason: SandboxExecError.make({ name, operation, cause }) });

  static sandboxExpose =
    (name: string, sandboxPort: number) =>
    (cause: unknown): SandboxError =>
      SandboxError.make({ reason: SandboxExposeError.make({ name, sandboxPort, cause }) });
}
