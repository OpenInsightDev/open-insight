import { Formatter, Schema } from "effect";

/** An event does not satisfy the contract required for publication. */
export class InvalidEvent extends Schema.TaggedErrorClass<InvalidEvent>(
  "open-insight/eval/EventError/InvalidEvent",
)("InvalidEvent", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid evaluation event: ${Formatter.format(this.cause)}`;
  }
}

/** One or more events could not be delivered to their destination. */
export class SendFailed extends Schema.TaggedErrorClass<SendFailed>(
  "open-insight/eval/EventError/SendFailed",
)("SendFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to send evaluation events: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([InvalidEvent, SendFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by event publication operations. */
export class EventError extends Schema.TaggedErrorClass<EventError>("open-insight/eval/EventError")(
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
}
