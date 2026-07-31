import { Schema } from "effect";

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

export const ErrorReason = PromptError;
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
}
