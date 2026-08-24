import { hasProperty } from "effect/Predicate";
import { type Tool, Toolkit } from "effect/unstable/ai";
import type { Override } from "#/utils/type.ts";
import * as Task from "./task.ts";

const Field: unique symbol = Symbol.for("TaskToolkitField");
export type Mixin<Tools extends Record<string, Tool.Any>> = Readonly<{
  [Field]: {
    toolkit: Toolkit.Toolkit<Tools>;
  };
}>;
export type ToolsOf<T> = T extends Mixin<infer Tools> ? Tools : never;

export const hasToolkit = <T, Tools extends Record<string, Tool.Any>>(
  value: T,
): value is T & Mixin<Tools> => hasProperty(value, Field);

export const toolkitOf = <Tools extends Record<string, Tool.Any>>(value: Mixin<Tools>) =>
  value[Field]["toolkit"];

export const toolkit =
  <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
  <T extends Task.Any>(task: T): Override<T, Mixin<Tools>> =>
    Object.assign(task, { [Field]: { toolkit } });
