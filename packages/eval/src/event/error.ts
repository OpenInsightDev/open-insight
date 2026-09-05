import { Formatter, Schema } from "effect";

/** An event does not satisfy the contract required for publication. */
export class InvalidEvent extends Schema.TaggedError<InvalidEvent>(
  "open-insight/eval/EventError/InvalidEvent",
)("InvalidEvent", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid evaluation event: ${Formatter.format(this.cause)}`;
  }
}

/** One or more events could not be delivered to their destination. */
export class SendFailed extends Schema.TaggedError<SendFailed>(
  "open-insight/eval/EventError/SendFailed",
)("SendFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to send evaluation events: ${Formatter.format(this.cause)}`;
  }
}

/** Event persistence failed while reading or writing JSONL data. */
export class PersistFailed extends Schema.TaggedError<PersistFailed>(
  "open-insight/eval/EventError/PersistFailed",
)("PersistFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Event persistence failed: ${Formatter.format(this.cause)}`;
  }
}

/** A trail result could not be assembled from its events. */
export class ResultFailed extends Schema.TaggedError<ResultFailed>(
  "open-insight/eval/EventError/ResultFailed",
)("ResultFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Event result construction failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([InvalidEvent, SendFailed, PersistFailed, ResultFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by event processing. */
export class EventError extends Schema.TaggedError<EventError>("open-insight/eval/EventError")(
  "EventError",
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

  static invalid = (cause: unknown): EventError =>
    EventError.make({ reason: InvalidEvent.make({ cause }) });

  static send = (cause: unknown): EventError =>
    EventError.make({ reason: SendFailed.make({ cause }) });

  static persist = (cause: unknown): EventError =>
    EventError.make({ reason: PersistFailed.make({ cause }) });

  static result = (cause: unknown): EventError =>
    EventError.make({ reason: ResultFailed.make({ cause }) });
}
