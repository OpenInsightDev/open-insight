import { Effect, Crypto } from "effect";

export const makeID = Effect.fn(function* (length: number = 4) {
  const crypto = yield* Crypto.Crypto;
  const uuid = yield* crypto.randomBytes(length);
  return Buffer.from(uuid).toString("hex").slice(0, length);
});
