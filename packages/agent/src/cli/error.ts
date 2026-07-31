import { Schema } from "effect";

const Cause = Schema.Error();

/** A CLI's help output could not be fetched. */
export class HelpError extends Schema.TaggedErrorClass<HelpError>()("HelpError", {
  command: Schema.String,
  operation: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to run ${this.operation} for CLI "${this.command}": ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([HelpError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by CLI help fetching. */
export class Error extends Schema.TaggedErrorClass<Error>()("CliError", {
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

  static help = (command: string) =>
    this.mapUnknownError((cause) => new HelpError({ command, operation: "help", cause }));
}
