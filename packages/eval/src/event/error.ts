import { Schema } from "effect";

const Cause = Schema.Error();

/** An event does not satisfy the contract required for publication. */
export class Invalid extends Schema.TaggedErrorClass<Invalid>()("Invalid", {
  cause: Cause,
}) {
  override get message(): string {
    return `Invalid evaluation event: ${this.cause.message}`;
  }
}

/** One or more events could not be delivered to their destination. */
export class SendFailed extends Schema.TaggedErrorClass<SendFailed>()("SendFailed", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to send evaluation events: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([Invalid, SendFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by event publication operations. */
export class Error extends Schema.TaggedErrorClass<Error>()("EventError", {
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

  static invalid = this.mapUnknownError((cause) => new Invalid({ cause }));

  static send = this.mapUnknownError((cause) => new SendFailed({ cause }));
}
