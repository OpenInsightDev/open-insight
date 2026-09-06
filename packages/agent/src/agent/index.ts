import { Data } from "effect";
import type { Tool, Toolkit } from "effect/unstable/ai";

export class Agent<Tools extends Record<string, Tool.Any>> extends Data.Class<{
  toolkit: Toolkit.Toolkit<Tools>;
}> {}

export type StreamOptions = Readonly<{}>;
export const stream = (options: StreamOptions) => {};
