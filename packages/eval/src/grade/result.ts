import { Effect, Schema } from "effect";
import { GradeError } from "./error.ts";

export type AnyResult = Schema.Constraint;

export const decodeResult = <S extends AnyResult>(schema: S, result: S["Encoded"]) =>
  Schema.decodeEffect(schema)(result).pipe(Effect.mapError(GradeError.result));
