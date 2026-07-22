import { Effect, Crypto } from "effect";

export const makeID = Effect.fn(function* (length: number = 4) {
  const crypto = yield* Crypto.Crypto;
  const rand = yield* crypto.randomBytes(length);
  return Buffer.from(rand).toString("hex").slice(0, length);
});
