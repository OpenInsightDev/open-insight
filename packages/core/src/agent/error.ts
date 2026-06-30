import { Schema } from "effect";
import { AiError } from "effect/unstable/ai";

export class StreamError extends Schema.TaggedErrorClass<StreamError>()("StreamError", {
  cause: Schema.Defect(),
}) {}

export const AgentErrorReason = Schema.Union([StreamError]);

export class AgentError extends Schema.TaggedErrorClass<AgentError>()("AgentError", {
  reason: AgentErrorReason,
}) {
  static stream = (error: AiError.AiError) =>
    new AgentError({ reason: new StreamError({ cause: error }) });
}
