import { Schema } from "effect";

const Cause = Schema.Error();

export class ClientError extends Schema.TaggedErrorClass<ClientError>()("ClientError", {
  server: Schema.String,
  operation: Schema.String,
  cause: Cause,
}) {
  override get message(): string {
    return `MCP server "${this.server}" failed during ${this.operation}: ${this.cause.message}`;
  }
}

export class ToolConflict extends Schema.TaggedErrorClass<ToolConflict>()("ToolConflict", {
  toolName: Schema.String,
  sources: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `MCP tool "${this.toolName}" is defined by multiple sources: ${this.sources.join(", ")}`;
  }
}

export const ErrorReason = Schema.Union([ClientError, ToolConflict]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by MCP operations. */
export class Error extends Schema.TaggedErrorClass<Error>()("McpError", {
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

  static client = (server: string, operation: string) =>
    this.mapUnknownError((cause) => new ClientError({ server, operation, cause }));

  static toolConflict = (toolName: string, sources: ReadonlyArray<string>) =>
    new Error({ reason: new ToolConflict({ toolName, sources }) });
}
