import { describe, expect, it } from "vite-plus/test";
import { Effect, Fiber, FiberSet, Ref, Semaphore } from "effect";

const runExperiment = (yieldAfterFork: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Ref.make<string[]>([]);
      const fibers = yield* FiberSet.make();

      for (let index = 0; index < 4; index++) {
        yield* FiberSet.run(
          fibers,
          Effect.gen(function* () {
            yield* Ref.update(events, (current) => [...current, `start-${index}`]);
            yield* Effect.yieldNow;
            yield* Ref.update(events, (current) => [...current, `end-${index}`]);
          }),
        );
        if (yieldAfterFork) {
          yield* Effect.yieldNow;
        }
      }

      yield* FiberSet.awaitEmpty(fibers);
      return yield* Ref.get(events);
    }),
  );

const runForkStartExperiment = (deferred: boolean, parentCount = 2, trailsPerParent = 2) =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Ref.make<string[]>([]);
      const fibers = yield* FiberSet.make();
      const parent = (name: string) =>
        Effect.gen(function* () {
          for (let index = 1; index <= trailsPerParent; index++) {
            yield* Ref.update(events, (current) => [...current, `${name}${index}-create`]);
            const child = Ref.update(events, (current) => [...current, `${name}${index}-start`]);
            if (deferred) {
              const fiber = yield* Effect.forkChild(child);
              yield* FiberSet.add(fibers, fiber);
            } else {
              yield* FiberSet.run(fibers, child);
            }
            yield* Effect.yieldNow;
          }
        });

      const parents = yield* Effect.all(
        Array.from({ length: parentCount }, (_, index) =>
          Effect.forkChild(parent(String.fromCharCode(65 + index))),
        ),
      );
      yield* Effect.all(parents.map(Fiber.join));
      yield* FiberSet.awaitEmpty(fibers);
      return yield* Ref.get(events);
    }),
  );

const runPermitExperiment = (permits: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Ref.make<string[]>([]);
      const fibers = yield* FiberSet.make();
      const semaphore = yield* Semaphore.make(permits);
      const parent = (name: string) =>
        Effect.gen(function* () {
          for (let index = 1; index <= 6; index++) {
            yield* FiberSet.run(
              fibers,
              semaphore.withPermit(
                Effect.gen(function* () {
                  yield* Ref.update(events, (current) => [...current, `${name}${index}`]);
                  yield* Effect.yieldNow;
                }),
              ),
            );
            yield* Effect.yieldNow;
          }
        });

      const parents = yield* Effect.all([
        Effect.forkChild(parent("A")),
        Effect.forkChild(parent("B")),
        Effect.forkChild(parent("C")),
        Effect.forkChild(parent("D")),
      ]);
      yield* Effect.all(parents.map(Fiber.join));
      yield* FiberSet.awaitEmpty(fibers);
      return yield* Ref.get(events);
    }),
  );

describe("Effect.yieldNow scheduling", () => {
  it("does not yield the parent when it is omitted", async () => {
    await expect(Effect.runPromise(runExperiment(false))).resolves.toEqual([
      "start-0",
      "start-1",
      "start-2",
      "start-3",
      "end-0",
      "end-1",
      "end-2",
      "end-3",
    ]);
  });

  it("lets the first queued child continue before the parent starts the next child", async () => {
    await expect(Effect.runPromise(runExperiment(true))).resolves.toEqual([
      "start-0",
      "end-0",
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
    ]);
  });

  it("defers child startup when forkChild is used instead of FiberSet.run", async () => {
    await expect(Effect.runPromise(runForkStartExperiment(false))).resolves.toEqual([
      "A1-create",
      "A1-start",
      "B1-create",
      "B1-start",
      "A2-create",
      "A2-start",
      "B2-create",
      "B2-start",
    ]);
    await expect(Effect.runPromise(runForkStartExperiment(true))).resolves.toEqual([
      "A1-create",
      "B1-create",
      "A1-start",
      "A2-create",
      "B1-start",
      "B2-create",
      "A2-start",
      "B2-start",
    ]);
  });

  it("keeps the startup difference across many fibers and repeated runs", async () => {
    const runs = 25;
    const parentCount = 16;
    const trailsPerParent = 8;

    for (const deferred of [false, true]) {
      for (let run = 0; run < runs; run++) {
        const events = await Effect.runPromise(
          runForkStartExperiment(deferred, parentCount, trailsPerParent),
        );
        expect(events).toHaveLength(parentCount * trailsPerParent * 2);

        const delayedStarts = events.filter((event, index) => {
          if (!event.endsWith("-start")) return false;
          const id = event.slice(0, -6);
          return events[index - 1] !== `${id}-create`;
        });
        if (deferred) {
          expect(delayedStarts.length).toBeGreaterThan(0);
        } else {
          expect(delayedStarts).toHaveLength(0);
        }
      }
    }
  });

  it("shows that Semaphore does not itself make acquisition round-robin", async () => {
    for (let run = 0; run < 25; run++) {
      const events = await Effect.runPromise(runPermitExperiment(1));
      expect(events).toHaveLength(24);
      expect(events.slice(0, 6).every((event) => event.startsWith("A"))).toBe(true);
    }
  });
});
