/**
 * Public exports for the `agent` module.
 *
 * `agent` builds stateful agent sessions with context management middlewares
 * applied around every round, driving `LanguageModel.streamText` directly.
 */
export { AgentError, ErrorReason, StreamFailed } from "./error.ts";
export { Service, layerFrom, type Session } from "./index.ts";

export * as Internal from "./index.ts";
