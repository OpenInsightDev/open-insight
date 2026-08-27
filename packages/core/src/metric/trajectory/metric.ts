import type { Stream } from "effect";
import * as Traj from "#/trajectory/index.ts";
import { Response, Tool } from "effect/unstable/ai";

export type Turn = Readonly<{}>;

type InputStream<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  Traj.PromptMessage | Response.PartView<Tools>
>;
