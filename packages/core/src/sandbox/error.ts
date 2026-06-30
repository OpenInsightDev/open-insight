import { Schema } from "effect";
import { Snapshot } from "./snapshot/index.ts";
import { Instruction } from "./snapshot/instruction.ts";
import * as Context from "./context/schema.ts";

export class ContextResolveError extends Schema.TaggedErrorClass<ContextResolveError>()(
  "ContextResolveError",
  {
    mode: Context.ModeSchema,
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

export const SandboxErrorReason = Schema.Union([
  ContextResolveError,
  ProviderError,
  SnapshotError,
  SandboxExecError,
  SandboxExposeError,
  SnapshotUnsupportedError,
  InstructionUnsupportedError,
]);

export class SandboxError extends Schema.TaggedErrorClass<SandboxError>()("SandboxError", {
  reason: SandboxErrorReason,
}) {
  static contextResolve = (mode: Context.Mode) => (cause: unknown) =>
    this.make({
      reason: ContextResolveError.make({
        mode,
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
}
