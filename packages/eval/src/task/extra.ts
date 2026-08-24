import { Option, type Schema } from "effect";
import { hasProperty } from "effect/Predicate";

const Field: unique symbol = Symbol.for("ExtraField");
export type Mixin<S extends Schema.Constraint> = Readonly<{
  [Field]: {
    schema: S;
    value: S["Type"];
  };
}>;
export type ExtraOf<T> = T extends Mixin<infer S> ? S["Type"] : never;

export const extraOf = <T extends object>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as ExtraOf<T>) : null);

export const extra =
  <T extends Schema.Constraint>(schema: T, value: T["Type"]) =>
  <Task extends Record<string, any>>(task: Task): Task & Mixin<T> =>
    Object.assign(task, { [Field]: { schema, value } });
