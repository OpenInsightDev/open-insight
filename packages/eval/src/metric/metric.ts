import { Data, Schema } from "effect";
import * as Sched from "./schedule/index.ts";
import * as Traj from "./trajectory/index.ts";

export type Metric<ID extends string, S extends Schema.Constraint> = Data.TaggedEnum<{
  Sched: Sched.Metric<ID, S>;
  Traj: Traj.Metric<ID, S>;
}>;
export type Any = Metric<any, any>;
