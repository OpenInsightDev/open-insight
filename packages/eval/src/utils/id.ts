import { Effect, Schema } from "effect";
import * as Uuid from "uuid";

export const makeID = Effect.fn(() => Effect.sync(() => Uuid.v4()));

export const IDSchema = Schema.String.pipe(
  Schema.withConstructorDefault(makeID()),
  Schema.withDecodingDefaultType(makeID()),
);
