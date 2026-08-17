import { Data, Formatter } from "effect";
import type { PlatformError } from "effect";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";

export class NonZeroExit extends Data.TaggedError("NonZeroExit")<{
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `process exited with code ${this.exitCode}`;
  }
}

export class Platform extends Data.TaggedError("Platform")<{
  readonly cause: PlatformError.PlatformError;
}> {
  override get message(): string {
    return `platform error: ${Formatter.format(this.cause)}`;
  }
}

export type ErrorReason = NonZeroExit | Platform;

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly reason: ErrorReason;
}> {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static platform = (cause: PlatformError.PlatformError): SpawnError =>
    new SpawnError({ reason: new Platform({ cause }) });

  static exit = (exitCode: ExitCode, stdout: string, stderr: string): SpawnError =>
    new SpawnError({ reason: new NonZeroExit({ exitCode, stdout, stderr }) });
}
