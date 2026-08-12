import { Effect, Schema } from "effect";
import { GradeError } from "./error.ts";

export type AnyResult = Schema.ConstraintCodec<unknown, object>;

export const decodeResult = <S extends AnyResult>(schema: S, result: unknown) =>
  Schema.decodeUnknownEffect(schema)(result).pipe(Effect.mapError(GradeError.result));
