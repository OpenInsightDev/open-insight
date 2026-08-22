import { Toolkit, type Tool } from "effect/unstable/ai";

export type Options<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit?: Toolkit.Toolkit<Tools>;
}>;

export const make = () => {};
