import { Prompt, type Sandbox } from "@open-insight/core/internal";
import { Effect, Equal, Schema } from "effect";
import { GradeError } from "./error.ts";
import type { AnyResult } from "./result.ts";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

export type Exec = (context: Context) => PromiseLike<Prompt.RawInput | null>;

export type Verif<R extends AnyResult = AnyResult> = Readonly<{
  exec: Exec;
  expect: Partial<R["Encoded"]>;
}>;

export const matches =
  <R extends AnyResult>(schema: R) =>
  ({
    result,
    expect,
  }: {
    result: R["Encoded"];
    expect: Partial<R["Encoded"]>;
  }): Effect.Effect<boolean, GradeError, R["DecodingServices"]> =>
    Effect.all([
      Schema.decodeEffect(schema)(result),
      // Preserve result fields while overriding the fields declared by expect
      Schema.decodeEffect(schema)(Object.assign({}, result, expect)),
    ]).pipe(
      Effect.map(([actual, expected]) => Equal.equals(actual, expected)),
      Effect.mapError(GradeError.result),
    );
