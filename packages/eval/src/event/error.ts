import { Schema } from "effect";

/** An event does not satisfy the contract required for publication. */
export class InvalidEvent extends Schema.TaggedErrorClass<InvalidEvent>()("InvalidEvent", {
  cause: Schema.Defect(),
}) {}

/** One or more events could not be delivered to their destination. */
export class DeliveryFailed extends Schema.TaggedErrorClass<DeliveryFailed>()("DeliveryFailed", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([InvalidEvent, DeliveryFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by event publication operations. */
export class Error extends Schema.TaggedErrorClass<Error>()("EventError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static invalid = this.mapUnknownError((cause) => new InvalidEvent({ cause }));

  static delivery = this.mapUnknownError((cause) => new DeliveryFailed({ cause }));
}
