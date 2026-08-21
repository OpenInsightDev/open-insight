import type { Schema } from "effect";
import * as Task from "./build.ts";

export type Mixin<S extends Schema.Constraint> = Readonly<{
  extra: S["Type"];
}>;

export type TaskWithExtra<S extends Schema.Constraint> = Task.Any & Mixin<S>;
