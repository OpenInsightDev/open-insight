import { Schema } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";

export class InitError extends Schema.TaggedErrorClass<InitError>()("HarnessInitError", {
  cause: Sandbox.Error,
}) {
  override get message(): string {
    return `Failed to initialize harness: ${this.cause.message}`;
  }
}

export class SnapshotAcquireError extends Schema.TaggedErrorClass<SnapshotAcquireError>()(
  "HarnessSnapshotAcquireError",
  {
    snapshot: Snapshot.Snapshot,
    cause: Sandbox.Error,
  },
) {
  override get message(): string {
    return `Failed to acquire harness snapshot: ${this.cause.message}`;
  }
}

export class SnapshotDeriveError extends Schema.TaggedErrorClass<SnapshotDeriveError>()(
  "HarnessSnapshotDeriveError",
  {
    instructions: Snapshot.Instructions,
    cause: Sandbox.Error,
  },
) {
  override get message(): string {
    return `Failed to derive harness snapshot: ${this.cause.message}`;
  }
}

export class SandboxRunError extends Schema.TaggedErrorClass<SandboxRunError>()(
  "HarnessSandboxRunError",
  {
    cause: Sandbox.Error,
  },
) {
  override get message(): string {
    return `Failed to run harness sandbox: ${this.cause.message}`;
  }
}

export class SessionNotStartedError extends Schema.TaggedErrorClass<SessionNotStartedError>()(
  "HarnessSessionNotStartedError",
  {},
) {
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
  Agent.Error,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("HarnessError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static snapshotAcquire = (snapshot: Snapshot.Snapshot) => (cause: Sandbox.Error) =>
    new Error({ reason: new SnapshotAcquireError({ snapshot, cause }) });

  static snapshotDerive = (instructions: Snapshot.Instructions) => (cause: Sandbox.Error) =>
    new Error({ reason: new SnapshotDeriveError({ instructions, cause }) });

  static sandbox = (cause: Sandbox.Error) => new Error({ reason: new SandboxRunError({ cause }) });

  static agent = (cause: Agent.Error) => new Error({ reason: cause });

  static sessionNotStarted = () => new Error({ reason: new SessionNotStartedError() });
}
