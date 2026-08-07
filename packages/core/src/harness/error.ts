import { Schema } from "effect";
import * as Agent from "#/agent/index.ts";
import { SandboxError } from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";

export class InitError extends Schema.TaggedError<InitError>("open-insight/HarnessError/InitError")(
  "InitError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize harness: ${this.cause}`;
  }
}

export class SnapshotAcquireError extends Schema.TaggedError<SnapshotAcquireError>(
  "open-insight/HarnessError/SnapshotAcquireError",
)("SnapshotAcquireError", {
  snapshot: Snapshot.Template,
  cause: SandboxError,
}) {
  override get message(): string {
    return `Failed to acquire harness snapshot: ${this.cause.message}`;
  }
}

export class SnapshotDeriveError extends Schema.TaggedError<SnapshotDeriveError>(
  "open-insight/HarnessError/SnapshotDeriveError",
)("SnapshotDeriveError", {
  instructions: Snapshot.Instructions,
  cause: SandboxError,
}) {
  override get message(): string {
    return `Failed to derive harness snapshot: ${this.cause.message}`;
  }
}

export class SandboxRunError extends Schema.TaggedError<SandboxRunError>(
  "open-insight/HarnessError/SandboxRunError",
)("SandboxRunError", {
  cause: SandboxError,
}) {
  override get message(): string {
    return `Failed to run harness sandbox: ${this.cause.message}`;
  }
}

export class SessionNotStartedError extends Schema.TaggedError<SessionNotStartedError>(
  "open-insight/HarnessError/SessionNotStartedError",
)("SessionNotStartedError", {}) {
  override get message(): string {
    return "Agent session has not been started";
  }
}

export const ErrorReason = Schema.Union([
  InitError,
  SnapshotAcquireError,
  SnapshotDeriveError,
  SandboxRunError,
  SessionNotStartedError,
  Agent.AgentError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class HarnessError extends Schema.TaggedError<HarnessError>("open-insight/HarnessError")(
  "HarnessError",
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

  static init = (cause: unknown): HarnessError =>
    HarnessError.make({ reason: InitError.make({ cause }) });

  static snapshotAcquire =
    (snapshot: Snapshot.Template) =>
    (cause: SandboxError): HarnessError =>
      HarnessError.make({ reason: SnapshotAcquireError.make({ snapshot, cause }) });

  static snapshotDerive =
    (instructions: Snapshot.Instructions) =>
    (cause: SandboxError): HarnessError =>
      HarnessError.make({ reason: SnapshotDeriveError.make({ instructions, cause }) });

  static sandbox = (cause: SandboxError): HarnessError =>
    HarnessError.make({ reason: SandboxRunError.make({ cause }) });

  static agent = (cause: Agent.AgentError): HarnessError => HarnessError.make({ reason: cause });

  static sessionNotStarted = (): HarnessError =>
    HarnessError.make({ reason: SessionNotStartedError.make() });
}
