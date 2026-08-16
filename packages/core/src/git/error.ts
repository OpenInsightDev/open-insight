import { Schema } from "effect";
import * as Spawn from "#/utils/spawn.ts";

export class NotARepo extends Schema.TaggedError<NotARepo>("open-insight/GitError/NotARepo")(
  "NotARepo",
  {
    cwd: Schema.String,
  },
) {
  override get message(): string {
    return `Run directory "${this.cwd}" is not a git repository`;
  }
}

export class DirtyWorkingTree extends Schema.TaggedError<DirtyWorkingTree>(
  "open-insight/GitError/DirtyWorkingTree",
)("DirtyWorkingTree", {
  cwd: Schema.String,
}) {
  override get message(): string {
    return `Git working tree at "${this.cwd}" is dirty; commit or stash changes before running the operation`;
  }
}

export class GitUnavailable extends Schema.TaggedError<GitUnavailable>(
  "open-insight/GitError/GitUnavailable",
)("GitUnavailable", {}) {
  override get message(): string {
    return `Git is not available: ${this.cause}`;
  }
}

export class CheckFailed extends Schema.TaggedError<CheckFailed>(
  "open-insight/GitError/CheckFailed",
)("CheckFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Git check failed: ${this.cause}`;
  }
}

export const ErrorReason = Schema.Union([NotARepo, DirtyWorkingTree, GitUnavailable, CheckFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class GitError extends Schema.TaggedError<GitError>("open-insight/GitError")("GitError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static notGitRepo = (cwd: string): GitError => GitError.make({ reason: NotARepo.make({ cwd }) });

  static dirtyWorkingTree = (cwd: string): GitError =>
    GitError.make({ reason: DirtyWorkingTree.make({ cwd }) });

  static gitUnavailable = () => GitError.make({ reason: GitUnavailable.make({}) });

  static checkFailed = (cause: Spawn.Error): GitError =>
    GitError.make({ reason: CheckFailed.make({ cause }) });
}
