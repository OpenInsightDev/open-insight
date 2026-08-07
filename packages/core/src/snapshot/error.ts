import { Formatter, Schema } from "effect";
import { Template } from "./template.ts";
import { Instruction, Instructions } from "./inst.ts";

export class BuildError extends Schema.TaggedError<BuildError>(
  "open-insight/SnapshotError/BuildError",
)("BuildError", {
  template: Schema.suspend(() => Template),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to build snapshot: ${Formatter.format(this.cause)}`;
  }
}

export class DeriveError extends Schema.TaggedError<DeriveError>(
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

export class UseError extends Schema.TaggedError<UseError>("open-insight/SnapshotError/UseError")(
  "UseError",
  {
    name: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to use snapshot "${this.name}": ${Formatter.format(this.cause)}`;
  }
}

export class InstructionUnsupported extends Schema.TaggedError<InstructionUnsupported>(
  "open-insight/SnapshotError/InstructionUnsupported",
)("InstructionUnsupported", {
  name: Schema.String,
  template: Schema.suspend(() => Template),
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
  InstructionUnsupported,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class SnapshotError extends Schema.TaggedError<SnapshotError>("open-insight/SnapshotError")(
  "SnapshotError",
  {
    reason: ErrorReason,
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static build =
    (template: Template) =>
    (cause: unknown): SnapshotError =>
      SnapshotError.make({ reason: BuildError.make({ template, cause }) });

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
    template: Template,
    instruction: Instruction,
  ): SnapshotError =>
    SnapshotError.make({
      reason: InstructionUnsupported.make({ name, template, instruction }),
    });
}
