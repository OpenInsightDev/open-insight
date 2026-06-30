import { Effect, Latch, Ref } from "effect";

export const make = Effect.fn(function* (count: number) {
  const countDown = yield* Ref.make(count);
  const latch = yield* Latch.make();

  return {
    open: Effect.gen(function* () {
      const currCount = yield* Ref.updateAndGet(countDown, (c) => c - 1);
      if (currCount <= 0) {
        yield* latch.open;
      }
    }),
    await: latch.await,
  };
});
