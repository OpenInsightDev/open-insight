import { Formatter, Schema } from "effect";
import { Snapshot } from "./build.ts";
import { Instruction, Instructions } from "./inst.ts";

export class BuildError extends Schema.TaggedErrorClass<BuildError>(
  "open-insight/SnapshotError/BuildError",
)("BuildError", {
  snapshot: Schema.suspend(() => Snapshot),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to build snapshot: ${Formatter.format(this.cause)}`;
  }
}

export class DeriveError extends Schema.TaggedErrorClass<DeriveError>(
  "open-insight/SnapshotError/DeriveError",
)("DeriveError", {
  name: Schema.String,
  instructions: Instructions,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to derive snapshot "${this.name}": ${Formatter.format(this.cause)}`;
  }
}

export class UseError extends Schema.TaggedErrorClass<UseError>(
  "open-insight/SnapshotError/UseError",
)("UseError", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to use snapshot "${this.name}": ${Formatter.format(this.cause)}`;
  }
}

export class InstructionUnsupportedError extends Schema.TaggedErrorClass<InstructionUnsupportedError>(
  "open-insight/SnapshotError/InstructionUnsupportedError",
)("InstructionUnsupportedError", {
  name: Schema.String,
  snapshot: Schema.suspend(() => Snapshot),
  instruction: Instruction,
}) {
  override get message(): string {
    return `Snapshot provider "${this.name}" does not support ${this.instruction._tag} instructions`;
  }
}

export const ErrorReason = Schema.Union([
  BuildError,
  DeriveError,
  UseError,
  InstructionUnsupportedError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class SnapshotError extends Schema.TaggedErrorClass<SnapshotError>(
  "open-insight/SnapshotError",
)("SnapshotError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static build =
    (snapshot: Snapshot) =>
    (cause: unknown): SnapshotError =>
      SnapshotError.make({ reason: BuildError.make({ snapshot, cause }) });

  static derive =
    (name: string, instructions: Instructions) =>
    (cause: unknown): SnapshotError =>
      SnapshotError.make({ reason: DeriveError.make({ name, instructions, cause }) });

  static usage =
    (name: string) =>
    (cause: unknown): SnapshotError =>
      SnapshotError.make({ reason: UseError.make({ name, cause }) });

  static instUnsupported = (
    name: string,
    snapshot: Snapshot,
    instruction: Instruction,
  ): SnapshotError =>
    SnapshotError.make({
      reason: InstructionUnsupportedError.make({ name, snapshot, instruction }),
    });
}
