import { Schema } from "effect";

/** Marker used when a resource should not have a practical limit. */
export const Unlimited = Schema.Literal("unlimited").pipe(Schema.brand("Unlimited"));
export type Unlimited = Schema.Schema.Type<typeof Unlimited>;

export const isUnlimited = Schema.is(Unlimited);

export const NonNegative = Schema.Union([
  Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  Unlimited,
]);

export const NonNegativeInt = Schema.Union([
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Unlimited,
]);
