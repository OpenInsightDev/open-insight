export {
  AcpError,
  ErrorReason,
  AuthenticationError,
  AuthenticationErrorReason,
  HttpTransportError,
  HttpTransportOperation,
  PromptCapability,
  PromptError,
  PromptErrorReason,
} from "./error.ts";
export { openHttpStream, openStream, openWebSocketStream } from "./http.ts";
export { type HttpStreamOptions, type WebSocketStreamOptions } from "./http.ts";
export { type ToAcpPromptOptions, toAcpPrompt } from "./prompt.ts";
export { layerFrom, type Options } from "./service.ts";
export { transform } from "./stream.ts";
export type { StreamPartEncoded } from "effect/unstable/ai/Response";

export * as Internal from "./index.ts";
