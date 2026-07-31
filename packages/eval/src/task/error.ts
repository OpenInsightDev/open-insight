import { Schema } from "effect";

const Cause = Schema.Error();

export class PromptError extends Schema.TaggedErrorClass<PromptError>()("PromptError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Task prompt failed: ${this.cause.message}`;
  }
}

export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>()("InvalidMetadata", {
  cause: Cause,
}) {
  override get message(): string {
    return `Invalid task metadata: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([PromptError, InvalidMetadata]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("TaskError", {
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

  static prompt = this.mapUnknownError((cause) => new PromptError({ cause }));

  static metadata = this.mapUnknownError((cause) => new InvalidMetadata({ cause }));
}
