import { Schema } from "effect";

/** An event does not satisfy the contract required for publication. */
export class Invalid extends Schema.TaggedErrorClass<Invalid>()("Invalid", {
  cause: Schema.Defect(),
}) {}

/** One or more events could not be delivered to their destination. */
export class SendFailed extends Schema.TaggedErrorClass<SendFailed>()("SendFailed", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([Invalid, SendFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by event publication operations. */
export class Error extends Schema.TaggedErrorClass<Error>()("EventError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static invalid = this.mapUnknownError((cause) => new Invalid({ cause }));

  static send = this.mapUnknownError((cause) => new SendFailed({ cause }));
}
