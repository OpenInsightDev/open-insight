import { Schema } from "effect";
import { Snapshot } from "./build.ts";
import { Instruction, Instructions } from "./inst.ts";

const Cause = Schema.Error();

export class BuildError extends Schema.TaggedErrorClass<BuildError>()("SnapshotBuildError", {
  snapshot: Schema.suspend(() => Snapshot),
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to build snapshot: ${this.cause.message}`;
  }
}

export class DeriveError extends Schema.TaggedErrorClass<DeriveError>()("SnapshotDeriveError", {
  name: Schema.String,
  instructions: Instructions,
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to derive snapshot "${this.name}": ${this.cause.message}`;
  }
}

export class UseError extends Schema.TaggedErrorClass<UseError>()("SnapshotUseError", {
  name: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to use snapshot "${this.name}": ${this.cause.message}`;
  }
}

export class InstructionUnsupportedError extends Schema.TaggedErrorClass<InstructionUnsupportedError>()(
  "InstructionUnsupportedError",
  {
    name: Schema.String,
    snapshot: Schema.suspend(() => Snapshot),
    instruction: Instruction,
  },
) {
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

export class Error extends Schema.TaggedErrorClass<Error>()("SnapshotError", {
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

  static build = (snapshot: Snapshot) =>
    this.mapUnknownError((cause) => BuildError.make({ snapshot, cause }));

  static derive = (name: string, instructions: Instructions) =>
    this.mapUnknownError((cause) => DeriveError.make({ name, instructions, cause }));

  static usage = (name: string) => this.mapUnknownError((cause) => UseError.make({ name, cause }));

  static instUnsupported = (name: string, snapshot: Snapshot, instruction: Instruction) =>
    this.mapUnknownError(() => InstructionUnsupportedError.make({ name, snapshot, instruction }));
}
