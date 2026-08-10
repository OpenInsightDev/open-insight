/**
 * Error hierarchy for the `agent` module.
 *
 * Follows the module error-design conventions: a single wrapper class
 * (`AgentError`) over a tagged union of reason variants, constructed
 * exclusively through `.make()` factories that wrap lower-boundary failures
 * unconditionally.
 */
import { Formatter, Schema } from "effect";

/**
 * The language model response stream failed while generating a response for a
 * session. Carries the raw cause from the underlying boundary: `AiError`
 * failures, schema decoding errors, tool handler failures, or toolkit
 * resolution errors.
 */
export class StreamFailed extends Schema.TaggedError<StreamFailed>(
  "open-insight/Agent/Error/StreamFailed",
)("StreamFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Agent response stream failed: ${Formatter.format(this.cause)}`;
  }
}

/** The union of every `AgentError` reason variant. */
export const ErrorReason = Schema.Union([StreamFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/**
 * The wrapper error for the `agent` module. Discriminate on `reason._tag`.
 */
export class AgentError extends Schema.TaggedError<AgentError>("open-insight/Agent/Error")(
  "AgentError",
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

  static stream = (cause: unknown): AgentError =>
    AgentError.make({ reason: StreamFailed.make({ cause }) });
}
