/**
 * Error hierarchy for the `activity` module.
 *
 * Follows the module error-design conventions: a single wrapper class
 * (`ActivityError`) over a tagged union of reason variants, constructed
 * exclusively through `.make()` factories that wrap lower-boundary failures
 * unconditionally. The reason variants double as the error schemas of the
 * durable activities, so failures cross the workflow journal typed.
 */
import { Formatter, Schema } from "effect";

/**
 * The task consumed all of its allowed model steps without completing the
 * acceptance DAG. Mirrors the existing `maxSteps` limit on agent prompts.
 */
export class MaxStepsExceeded extends Schema.TaggedError<MaxStepsExceeded>(
  "open-insight/Activity/Error/MaxStepsExceeded",
)("MaxStepsExceeded", {
  steps: Schema.Int,
}) {
  override get message(): string {
    return `Task exceeded max steps (${this.steps})`;
  }
}

/**
 * A stage failed its acceptance criteria and a human reviewer rejected it.
 * The workflow suspends for the review and fails with this variant on
 * rejection.
 */
export class StageRejected extends Schema.TaggedError<StageRejected>(
  "open-insight/Activity/Error/StageRejected",
)("StageRejected", {
  stage: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Stage "${this.stage}" was rejected: ${this.reason}`;
  }
}

/** A workspace operation (sandbox, tools, checkpoint) failed. */
export class WorkspaceFailed extends Schema.TaggedError<WorkspaceFailed>(
  "open-insight/Activity/Error/WorkspaceFailed",
)("WorkspaceFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Workspace operation failed: ${Formatter.format(this.cause)}`;
  }
}

/** The language model step failed. */
export class ModelFailed extends Schema.TaggedError<ModelFailed>(
  "open-insight/Activity/Error/ModelFailed",
)("ModelFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Model step failed: ${Formatter.format(this.cause)}`;
  }
}

/** Stage acceptance verification failed. */
export class VerifyFailed extends Schema.TaggedError<VerifyFailed>(
  "open-insight/Activity/Error/VerifyFailed",
)("VerifyFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Stage verification failed: ${Formatter.format(this.cause)}`;
  }
}

/** The union of every `ActivityError` reason variant. */
export const ErrorReason = Schema.Union([
  MaxStepsExceeded,
  StageRejected,
  WorkspaceFailed,
  ModelFailed,
  VerifyFailed,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/**
 * The wrapper error for the `activity` module. Discriminate on
 * `reason._tag`.
 */
export class ActivityError extends Schema.TaggedError<ActivityError>("open-insight/Activity/Error")(
  "ActivityError",
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

  /** Wraps any reason variant — used to lift activity failures into the task error channel. */
  static wrap = <Reason extends ErrorReason>(reason: Reason): ActivityError =>
    ActivityError.make({ reason });

  static maxStepsExceeded = (args: { steps: number }): ActivityError =>
    ActivityError.make({ reason: MaxStepsExceeded.make(args) });

  static stageRejected = (args: { stage: string; reason: string }): ActivityError =>
    ActivityError.make({ reason: StageRejected.make(args) });

  static workspaceFailed = (cause: unknown): ActivityError =>
    ActivityError.make({ reason: WorkspaceFailed.make({ cause }) });

  static modelFailed = (cause: unknown): ActivityError =>
    ActivityError.make({ reason: ModelFailed.make({ cause }) });

  static verifyFailed = (cause: unknown): ActivityError =>
    ActivityError.make({ reason: VerifyFailed.make({ cause }) });
}
