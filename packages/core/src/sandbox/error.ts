import { Schema } from "effect";
import { Assertion } from "./assert/schema.ts";
import { Snapshot } from "./snapshot/index.ts";
import { Instruction } from "./snapshot/instruction.ts";

const ContextMode = Schema.String;
type ContextMode = Schema.Schema.Type<typeof ContextMode>;

export class ContextResolveError extends Schema.TaggedErrorClass<ContextResolveError>()(
  "ContextResolveError",
  {
    mode: ContextMode,
    cause: Schema.Defect(),
  },
) {}

export class InvalidContextError extends Schema.TaggedErrorClass<InvalidContextError>()(
  "InvalidContextError",
  {
    cause: Schema.Defect(),
  },
) {}

export class SnapshotError extends Schema.TaggedErrorClass<SnapshotError>()("SnapshotError", {
  kind: Schema.Union([Schema.Literal("build"), Schema.Literal("use")]),
  snapshot: Snapshot,
  cause: Schema.Defect(),
  message: Schema.optional(Schema.String),
}) {}

export class ProviderError extends Schema.TaggedErrorClass<ProviderError>()("ProviderError", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {}

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
  ContextResolveError,
  InvalidContextError,
  ProviderError,
  SnapshotError,
  SandboxExecError,
  SandboxExposeError,
  SnapshotUnsupportedError,
  InstructionUnsupportedError,
  AssertionError,
]);

export class SandboxError extends Schema.TaggedErrorClass<SandboxError>()("SandboxError", {
  reason: SandboxErrorReason,
}) {
  static contextResolve = (mode: ContextMode) => (cause: unknown) =>
    this.make({
      reason: ContextResolveError.make({
        mode,
        cause,
      }),
    });

  static context = (cause: unknown) =>
    this.make({
      reason: InvalidContextError.make({
        cause,
      }),
    });

  static provider = (name: string) => (cause: unknown) =>
    this.make({
      reason: ProviderError.make({
        name,
        cause,
      }),
    });

  static snapshotBuild = (snapshot: Snapshot) => (cause: unknown) =>
    this.make({
      reason: SnapshotError.make({
        kind: "build",
        snapshot,
        cause,
      }),
    });

  static snapshotUsage = (snapshot: Snapshot) => (cause: unknown) =>
    this.make({
      reason: SnapshotError.make({
        kind: "use",
        snapshot,
        cause,
      }),
    });

  static sandboxExec =
    ({ name, operation }: { name: string; operation: string }) =>
    (cause: unknown) =>
      this.make({
        reason: SandboxExecError.make({
          name,
          operation,
          cause,
        }),
      });

  static sandboxExpose =
    ({ name, sandboxPort, hostPort }: { name: string; sandboxPort: number; hostPort: number }) =>
    (cause: unknown) =>
      this.make({
        reason: SandboxExposeError.make({
          name,
          sandboxPort,
          hostPort,
          cause,
        }),
      });

  static snapshotUnsupported = (name: string, snapshot: Snapshot) => (cause: unknown) =>
    this.make({
      reason: SnapshotUnsupportedError.make({
        name,
        snapshot,
        cause,
      }),
    });

  static instructionUnsupported = (name: string, snapshot: Snapshot, instruction: Instruction) =>
    this.make({
      reason: InstructionUnsupportedError.make({
        name,
        snapshot,
        instruction,
      }),
    });

  static assert = (failures: ReadonlyArray<AssertionFailure>) =>
    this.make({
      reason: AssertionError.make({
        failures: Array.from(failures),
      }),
    });
}
