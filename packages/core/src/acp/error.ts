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
}) {}

export const ErrorReason = PromptError;
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("AcpError", {
  reason: ErrorReason,
}) {
  static prompt = (reason: PromptError): Error => new Error({ reason });
}
