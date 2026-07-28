import { Schema } from "effect";

export class ClientError extends Schema.TaggedErrorClass<ClientError>()("McpClientError", {
  server: Schema.String,
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ToolNameConflictError extends Schema.TaggedErrorClass<ToolNameConflictError>()(
  "McpToolNameConflictError",
  {
    toolName: Schema.String,
    sources: Schema.Array(Schema.String),
  },
) {}

export type Error = ClientError | ToolNameConflictError;
