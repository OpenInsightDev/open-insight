import { Schema } from "effect";
import { Assertion } from "./assert/schema.ts";
import { Snapshot } from "./snapshot/index.ts";
import { Instruction, Instructions } from "./snapshot/inst.ts";

export class SnapshotBuildError extends Schema.TaggedErrorClass<SnapshotBuildError>()(
  "SnapshotBuildError",
  {
    snapshot: Snapshot,
    cause: Schema.Defect(),
  },
) {}

export class SnapshotDeriveError extends Schema.TaggedErrorClass<SnapshotDeriveError>()(
  "SnapshotDeriveError",
  {
    name: Schema.String,
    instructions: Instructions,
    cause: Schema.Defect(),
  },
) {}

export class SnapshotUseError extends Schema.TaggedErrorClass<SnapshotUseError>()(
  "SnapshotUseError",
  {
    name: Schema.String,
    cause: Schema.Defect(),
  },
) {}

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

export class SnapshotUnsupportedError extends Schema.TaggedErrorClass<SnapshotUnsupportedError>()(
  "SnapshotUnsupportedError",
  {
    name: Schema.String,
    snapshot: Snapshot,
    cause: Schema.Defect(),
  },
) {}

export class InstructionUnsupportedError extends Schema.TaggedErrorClass<InstructionUnsupportedError>()(
  "InstructionUnsupportedError",
  {
    name: Schema.String,
    snapshot: Snapshot,
    instruction: Instruction,
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

export const SandboxErrorReason = Schema.Union([
  SnapshotBuildError,
  SnapshotDeriveError,
  SnapshotUseError,
  ProviderNotAvailable,
  SandboxStartError,
  SandboxExecError,
  SandboxExposeError,
  SnapshotUnsupportedError,
  InstructionUnsupportedError,
  AssertionError,
]);
export type SandboxErrorReason = Schema.Schema.Type<typeof SandboxErrorReason>;

export class SandboxError extends Schema.TaggedErrorClass<SandboxError>()("SandboxError", {
  reason: SandboxErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => SandboxErrorReason) => (cause: unknown) =>
    cause instanceof SandboxError ? cause : new SandboxError({ reason: mapper(cause) });

  static provider = (name: string) =>
    this.mapUnknownError((cause) => ProviderNotAvailable.make({ name, cause }));

  static snapshotBuild = (snapshot: Snapshot) =>
    this.mapUnknownError((cause) => SnapshotBuildError.make({ snapshot, cause }));

  static snapshotDerive = (name: string, instructions: Instructions) =>
    this.mapUnknownError((cause) => SnapshotDeriveError.make({ name, instructions, cause }));

  static snapshotUsage = (name: string) =>
    this.mapUnknownError((cause) => SnapshotUseError.make({ name, cause }));

  static snapshotUnsupported = (name: string, snapshot: Snapshot) =>
    this.mapUnknownError((cause) => SnapshotUnsupportedError.make({ name, snapshot, cause }));

  static instructionUnsupported = (name: string, snapshot: Snapshot, instruction: Instruction) =>
    this.make({
      reason: InstructionUnsupportedError.make({ name, snapshot, instruction }),
    });

  static sandboxStart = (name: string) =>
    this.mapUnknownError((cause) => SandboxStartError.make({ name, cause }));

  static sandboxExec = (name: string, operation: string) =>
    this.mapUnknownError((cause) => SandboxExecError.make({ name, operation, cause }));

  static sandboxExpose = (name: string, sandboxPort: number, hostPort: number) =>
    this.mapUnknownError((cause) =>
      SandboxExposeError.make({ name, sandboxPort, hostPort, cause }),
    );

  static assert = (failures: ReadonlyArray<AssertionFailure>) =>
    this.make({
      reason: AssertionError.make({
        failures: Array.from(failures),
      }),
    });
}
