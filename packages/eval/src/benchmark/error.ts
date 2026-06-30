import { Schema } from "effect";

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export const BenchmarkErrorReason = Schema.Union([InitError]);

export class BenchmarkError extends Schema.TaggedErrorClass<BenchmarkError>()("BenchmarkError", {
  reason: BenchmarkErrorReason,
}) {
  static init = (cause: unknown) => new BenchmarkError({ reason: new InitError({ cause }) });
}
