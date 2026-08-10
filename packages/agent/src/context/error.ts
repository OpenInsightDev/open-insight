import { Formatter, Schema } from "effect";

export class InvalidMetadata extends Schema.TaggedError<InvalidMetadata>(
  "open-insight/Context/Error/InvalidMetadata",
)("InvalidMetadata", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid middleware metadata: ${Formatter.format(this.cause)}`;
  }
}

export class MiddlewareFailed extends Schema.TaggedError<MiddlewareFailed>(
  "open-insight/Context/Error/MiddlewareFailed",
)("MiddlewareFailed", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Middleware "${this.name}" failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([InvalidMetadata, MiddlewareFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class ContextError extends Schema.TaggedError<ContextError>("open-insight/Context/Error")(
  "ContextError",
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

  static invalidMetadata = (cause: unknown): ContextError =>
    ContextError.make({ reason: InvalidMetadata.make({ cause }) });

  static middlewareFailed = (name: string, cause: unknown): ContextError =>
    ContextError.make({ reason: MiddlewareFailed.make({ name, cause }) });
}
