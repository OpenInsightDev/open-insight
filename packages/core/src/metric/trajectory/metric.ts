import { Data, Schema, type Stream } from "effect";
import * as Traj from "#/trajectory/index.ts";
import { Response, Tool, Toolkit } from "effect/unstable/ai";

type InputStream<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  Traj.PromptMessage | Response.PartView<Tools>
>;

export type Exec<Tools extends Record<string, Tool.Any>, S extends Schema.Constraint> = (
  trajectory: Traj.Trajectory<Tools>,
) => Stream.Stream<S["Type"]>;

export class Metric<Tools extends Record<string, Tool.Any>> extends Data.Class<{
  toolkit: Toolkit.Toolkit<Tools>;
}> {}
