/**
 * Public exports for the `context` module.
 *
 * `context` provides the context management pipeline for agent sessions:
 * middlewares transform `{ sandbox, trajectory, responding, prompting }`
 * right before the next round of prompting, and the applied result is
 * committed by the agent loop.
 */
export {
  Service,
  layer,
  make,
  register,
  registerAfterRespond,
  registerPrePrompt,
} from "./index.ts";
export {
  Fn,
  Metadata,
  makeAfterRespond,
  makePrePrompt,
  toolMessages,
  userMessage,
  type AfterRespondFn,
  type AfterRespondResult,
  type AfterRespondState,
  type Middleware,
  type PrePromptFn,
  type PrePromptResult,
  type PrePromptState,
} from "./middleware.ts";

export * as Internal from "./index.ts";
