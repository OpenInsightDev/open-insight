import { Schema } from "effect";
import { Assertion } from "./assert/schema.ts";
import * as Snapshot from "../snapshot/index.ts";

const Cause = Schema.Error();

export class ProviderNotAvailable extends Schema.TaggedErrorClass<ProviderNotAvailable>()(
  "ProviderNotAvailable",
  {
    name: Schema.String,
    cause: Cause,
  },
) {
  override get message(): string {
    return `Sandbox provider "${this.name}" is not available: ${this.cause.message}`;
  }
}

export class SandboxStartError extends Schema.TaggedErrorClass<SandboxStartError>()(
  "SandboxStartError",
  {
    name: Schema.String,
    cause: Cause,
  },
) {
  override get message(): string {
    return `Failed to start sandbox "${this.name}": ${this.cause.message}`;
  }
}

export class SandboxExecError extends Schema.TaggedErrorClass<SandboxExecError>()(
  "SandboxExecError",
  {
    name: Schema.String,
    operation: Schema.String,
    cause: Cause,
  },
) {
  override get message(): string {
    return `Sandbox "${this.name}" failed during ${this.operation}: ${this.cause.message}`;
  }
}

export class SandboxExposeError extends Schema.TaggedErrorClass<SandboxExposeError>()(
  "SandboxExposeError",
  {
    name: Schema.String,
    sandboxPort: Schema.Number,
    cause: Cause,
  },
) {
  override get message(): string {
    return `Failed to expose port ${this.sandboxPort} from sandbox "${this.name}": ${this.cause.message}`;
  }
}

export class SnapshotBuildUnsupported extends Schema.TaggedErrorClass<SnapshotBuildUnsupported>()(
  "SnapshotBuildUnsupported",
  {
    name: Schema.String,
    snapshot: Snapshot.ContainerfileSnapshot,
  },
) {
  override get message(): string {
    return `Sandbox provider "${this.name}" does not support Containerfile snapshots`;
  }
}

export class AssertionFailure extends Schema.Class<AssertionFailure>("AssertionFailure")({
  assertion: Assertion,
  message: Schema.String,
  expected: Schema.optional(Schema.String),
  actual: Schema.optional(Schema.String),
}) {}

export class AssertionError extends Schema.TaggedErrorClass<AssertionError>()("AssertionError", {
  failures: Schema.Array(AssertionFailure),
}) {
  override get message(): string {
    return this.failures.length === 1
      ? `Sandbox assertion failed: ${this.failures[0].message}`
      : `${this.failures.length} sandbox assertions failed`;
  }
}

export const ErrorReason = Schema.Union([
  Snapshot.Error,
  ProviderNotAvailable,
  SandboxStartError,
  SandboxExecError,
  SandboxExposeError,
  SnapshotBuildUnsupported,
  AssertionError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("SandboxError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static mapUnknownError = (mapper: (cause: globalThis.Error) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error
      ? cause
      : new Error({ reason: mapper(Schema.decodeUnknownSync(Cause)(cause)) });

  static provider = (name: string) =>
    this.mapUnknownError((cause) => ProviderNotAvailable.make({ name, cause }));

  static snapshot = (mapper: (cause: globalThis.Error) => Snapshot.Error) =>
    this.mapUnknownError((cause) => (cause instanceof Snapshot.Error ? cause : mapper(cause)));

  static buildUnsupported = (name: string, snapshot: Snapshot.ContainerfileSnapshot) =>
    new Error({ reason: SnapshotBuildUnsupported.make({ name, snapshot }) });

  static sandboxStart = (name: string) =>
    this.mapUnknownError((cause) => SandboxStartError.make({ name, cause }));

  static sandboxExec = (name: string, operation: string) =>
    this.mapUnknownError((cause) => SandboxExecError.make({ name, operation, cause }));

  static sandboxExpose = (name: string, sandboxPort: number) =>
    this.mapUnknownError((cause) => SandboxExposeError.make({ name, sandboxPort, cause }));
}
