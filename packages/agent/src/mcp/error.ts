import { Schema } from "effect";

export class ClientError extends Schema.TaggedErrorClass<ClientError>()("McpClientError", {
  server: Schema.String,
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ToolConflict extends Schema.TaggedErrorClass<ToolConflict>()("McpToolConflict", {
  toolName: Schema.String,
  sources: Schema.Array(Schema.String),
}) {}

export const Error = Schema.Union([ClientError, ToolConflict]);
export type Error = Schema.Schema.Type<typeof Error>;
