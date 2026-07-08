import { Schema } from "effect";
import { Snapshot } from "./build.ts";
import { Instruction, Instructions } from "./inst.ts";

export class BuildError extends Schema.TaggedErrorClass<BuildError>()("SnapshotBuildError", {
  snapshot: Snapshot,
  cause: Schema.Defect(),
}) {}

export class DeriveError extends Schema.TaggedErrorClass<DeriveError>()("SnapshotDeriveError", {
  name: Schema.String,
  instructions: Instructions,
  cause: Schema.Defect(),
}) {}

export class UseError extends Schema.TaggedErrorClass<UseError>()("SnapshotUseError", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {}

export class UnsupportedError extends Schema.TaggedErrorClass<UnsupportedError>()(
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

export const ErrorReason = Schema.Union([
  BuildError,
  DeriveError,
  UseError,
  UnsupportedError,
  InstructionUnsupportedError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("SnapshotError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static build = (snapshot: Snapshot) =>
    this.mapUnknownError((cause) => BuildError.make({ snapshot, cause }));

  static derive = (name: string, instructions: Instructions) =>
    this.mapUnknownError((cause) => DeriveError.make({ name, instructions, cause }));

  static usage = (name: string) => this.mapUnknownError((cause) => UseError.make({ name, cause }));

  static unsupported = (name: string, snapshot: Snapshot) =>
    this.mapUnknownError((cause) => UnsupportedError.make({ name, snapshot, cause }));

  static instructionUnsupported = (name: string, snapshot: Snapshot, instruction: Instruction) =>
    this.mapUnknownError(() => InstructionUnsupportedError.make({ name, snapshot, instruction }));
}
