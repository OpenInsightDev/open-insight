import { Schema } from "effect";

const Cause = Schema.Error();

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize evaluation harness: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([InitError]);
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

  static mapUnknownError = (mapper: (cause: globalThis.Error) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error
      ? cause
      : new Error({ reason: mapper(Schema.decodeUnknownSync(Cause)(cause)) });

  static init = this.mapUnknownError((cause) => new InitError({ cause }));
}
