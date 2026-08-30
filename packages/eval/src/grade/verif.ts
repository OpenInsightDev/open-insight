import { Prompt, type Sandbox } from "@open-insight/core/internal";

import { Effect, Equal, Schema } from "effect";
import { GradeError } from "./error.ts";

export type Context = Sandbox.Sandbox;

export type Verif<Result extends Schema.Constraint = any> = Readonly<{
  exec: (context: Context) => Effect.Effect<Prompt.Prompt, GradeError>;
  expect: Partial<Result["Type"]>;
}>;

export type Exec<E = unknown, R = never> = (
  context: Context,
) => Effect.Effect<Prompt.RawInput, E, R>;

export const make = Effect.fn(function* <Result extends Schema.Constraint, E, R>({
  exec: execOption,
  expect,
}: Readonly<{
  exec: Exec<E, R>;
  expect: Partial<Result["Type"]>;
}>) {
  const ctx = yield* Effect.context<R>();

  const exec = ((context) =>
    execOption(context)
      .pipe(Effect.mapError(GradeError.verify), Effect.provide(ctx))
      .pipe(Effect.map(Prompt.make))) satisfies Verif["exec"];

  return { exec, expect } satisfies Verif<Result>;
});

export const isMatch = <Result extends Schema.Constraint>({
  result,
  expect,
}: Readonly<{
  expect: Partial<Result["Type"]>;
  result: Result["Type"];
}>) => Equal.equals(result, Object.assign({}, result, expect));
