import { Schema } from "effect";

export class ClientError extends Schema.TaggedErrorClass<ClientError>()("ClientError", {
  server: Schema.String,
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ToolConflict extends Schema.TaggedErrorClass<ToolConflict>()("ToolConflict", {
  toolName: Schema.String,
  sources: Schema.Array(Schema.String),
}) {}

export const ErrorReason = Schema.Union([ClientError, ToolConflict]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by MCP operations. */
export class Error extends Schema.TaggedErrorClass<Error>()("McpError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static client = (server: string, operation: string) =>
    this.mapUnknownError((cause) => new ClientError({ server, operation, cause }));

  static toolConflict = (toolName: string, sources: ReadonlyArray<string>) =>
    new Error({ reason: new ToolConflict({ toolName, sources }) });
}
