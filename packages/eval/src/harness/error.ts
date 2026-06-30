import { Schema } from "effect";

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export const HarnessErrorReason = Schema.Union([InitError]);

export class HarnessError extends Schema.TaggedErrorClass<HarnessError>()("HarnessError", {
  reason: HarnessErrorReason,
}) {
  static init = (cause: unknown) => new HarnessError({ reason: new InitError({ cause }) });
}
