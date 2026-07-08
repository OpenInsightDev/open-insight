import { Schema } from "effect";
import { Assertion } from "./assert/schema.ts";
import * as Snapshot from "../snapshot/index.ts";

export class ProviderNotAvailable extends Schema.TaggedErrorClass<ProviderNotAvailable>()(
  "ProviderNotAvailable",
  {
    name: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class SandboxStartError extends Schema.TaggedErrorClass<SandboxStartError>()(
  "SandboxStartError",
  {
    name: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class SandboxExecError extends Schema.TaggedErrorClass<SandboxExecError>()(
  "SandboxExecError",
  {
    name: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class SandboxExposeError extends Schema.TaggedErrorClass<SandboxExposeError>()(
  "SandboxExposeError",
  {
    name: Schema.String,
    sandboxPort: Schema.Number,
    hostPort: Schema.Number,
    cause: Schema.Defect(),
  },
) {}

export class AssertionFailure extends Schema.Class<AssertionFailure>("AssertionFailure")({
  assertion: Assertion,
  message: Schema.String,
  expected: Schema.optional(Schema.String),
  actual: Schema.optional(Schema.String),
}) {}

export class AssertionError extends Schema.TaggedErrorClass<AssertionError>()("AssertionError", {
  failures: Schema.Array(AssertionFailure),
}) {}

export const ErrorReason = Schema.Union([
  Snapshot.Error,
  ProviderNotAvailable,
  SandboxStartError,
  SandboxExecError,
  SandboxExposeError,
  AssertionError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("SandboxError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static provider = (name: string) =>
    this.mapUnknownError((cause) => ProviderNotAvailable.make({ name, cause }));

  static snapshot = (mapper: (cause: unknown) => Snapshot.Error) =>
    this.mapUnknownError((cause) => (cause instanceof Snapshot.Error ? cause : mapper(cause)));

  static sandboxStart = (name: string) =>
    this.mapUnknownError((cause) => SandboxStartError.make({ name, cause }));

  static sandboxExec = (name: string, operation: string) =>
    this.mapUnknownError((cause) => SandboxExecError.make({ name, operation, cause }));

  static sandboxExpose = (name: string, sandboxPort: number, hostPort: number) =>
    this.mapUnknownError((cause) =>
      SandboxExposeError.make({ name, sandboxPort, hostPort, cause }),
    );
}
