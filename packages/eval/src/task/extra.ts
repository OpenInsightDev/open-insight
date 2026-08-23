import type { Schema } from "effect";

const Field: unique symbol = Symbol.for("ExtraField");
export type Mixin<S extends Schema.Constraint> = Readonly<{
  [Field]: {
    schema: S;
    value: S["Type"];
  };
}>;

export const extraOf = <S extends Schema.Constraint>(value: Mixin<S>) => value[Field];

export const extra =
  <T extends Schema.Constraint>(schema: T, value: T["Type"]) =>
  <Task extends Record<string, any>>(task: Task): Task & Mixin<T> =>
    Object.assign(task, { [Field]: { schema, value } });
