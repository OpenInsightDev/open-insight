import { Formatter, Schema } from "effect";

export const PromptErrorReason = Schema.Literals([
  "capability_not_enabled",
  "invalid_base64",
  "invalid_data_url",
  "data_url_media_type_mismatch",
]);
export type PromptErrorReason = Schema.Schema.Type<typeof PromptErrorReason>;

export const PromptCapability = Schema.Literals(["image", "audio", "embeddedContext"]);
export type PromptCapability = Schema.Schema.Type<typeof PromptCapability>;

export class PromptError extends Schema.TaggedErrorClass<PromptError>()("AcpPromptError", {
  reason: PromptErrorReason,
  partIndex: Schema.Number,
  partType: Schema.Literals(["text", "file"]),
  mediaType: Schema.optional(Schema.String),
  capability: Schema.optional(PromptCapability),
}) {
  override get message(): string {
    switch (this.reason) {
      case "capability_not_enabled":
        return `ACP prompt part ${this.partIndex} requires the ${this.capability ?? "requested"} capability`;
      case "invalid_base64":
        return `ACP prompt part ${this.partIndex} contains invalid base64 data`;
      case "invalid_data_url":
        return `ACP prompt part ${this.partIndex} contains an invalid data URL`;
      case "data_url_media_type_mismatch":
        return `ACP prompt part ${this.partIndex} has a data URL media type mismatch`;
    }
  }
}

export const HttpTransportOperation = Schema.Literals([
  "parse-url",
  "connect",
  "request",
  "response",
]);
export type HttpTransportOperation = Schema.Schema.Type<typeof HttpTransportOperation>;

export class HttpTransportError extends Schema.TaggedErrorClass<HttpTransportError>()(
  "AcpHttpTransportError",
  {
    url: Schema.String,
    operation: HttpTransportOperation,
    status: Schema.optional(Schema.Number),
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const status = this.status === undefined ? "" : ` with HTTP status ${this.status}`;
    const detail =
      this.detail ?? (this.cause === undefined ? undefined : Formatter.format(this.cause));
    return `ACP HTTP transport ${this.operation} failed for ${this.url}${status}${detail === undefined ? "" : `: ${detail}`}`;
  }
}

export const AuthenticationErrorReason = Schema.Literals([
  "authentication_required",
  "unsupported_method",
  "authentication_failed",
]);
export type AuthenticationErrorReason = Schema.Schema.Type<typeof AuthenticationErrorReason>;

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "AcpAuthenticationError",
  {
    reason: AuthenticationErrorReason,
    methodId: Schema.optional(Schema.String),
    availableMethodIds: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const available = this.availableMethodIds.join(", ");
    switch (this.reason) {
      case "authentication_required":
        return available.length === 0
          ? "ACP agent requires authentication"
          : `ACP agent requires authentication; configure auth with one of: ${available}`;
      case "unsupported_method":
        return `ACP authentication method ${this.methodId} is not supported; available methods: ${available}`;
      case "authentication_failed":
        return `ACP authentication failed for method ${this.methodId}`;
    }
  }
}

export const ErrorReason = Schema.Union([PromptError, HttpTransportError, AuthenticationError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("AcpError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static prompt = (reason: PromptError): Error => new Error({ reason });

  static http =
    (url: string, operation: HttpTransportOperation, status?: number) =>
    (cause: unknown): Error =>
      cause instanceof Error
        ? cause
        : new Error({
            reason: HttpTransportError.make({
              url,
              operation,
              cause,
              ...(status === undefined ? {} : { status }),
            }),
          });

  static httpResponse = (url: string, status: number, detail: string): Error =>
    new Error({
      reason: HttpTransportError.make({ url, operation: "response", status, detail }),
    });

  static authenticationRequired = (
    availableMethodIds: ReadonlyArray<string>,
    cause?: unknown,
  ): Error =>
    new Error({
      reason: AuthenticationError.make({
        reason: "authentication_required",
        availableMethodIds: [...availableMethodIds],
        ...(cause === undefined ? {} : { cause }),
      }),
    });

  static unsupportedAuthenticationMethod = (
    methodId: string,
    availableMethodIds: ReadonlyArray<string>,
  ): Error =>
    new Error({
      reason: AuthenticationError.make({
        reason: "unsupported_method",
        methodId,
        availableMethodIds: [...availableMethodIds],
      }),
    });

  static authenticationFailed =
    (methodId: string) =>
    (cause: unknown): Error =>
      cause instanceof Error
        ? cause
        : new Error({
            reason: AuthenticationError.make({
              reason: "authentication_failed",
              methodId,
              availableMethodIds: [],
              cause,
            }),
          });
}
