import { assert, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { waitForAgentReady } from "./service.ts";

it.effect("waits longer than ten seconds for a cold agent to become ready", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = async () => {
      attempts += 1;
      if (attempts <= 21) {
        throw new TypeError("connect ECONNREFUSED");
      }
      return new Response(null, { status: 200 });
    };

    const ready = yield* waitForAgentReady(new URL("http://agent.test/acp"), { fetch }).pipe(
      Effect.forkChild,
    );
    yield* TestClock.adjust("11 seconds");
    yield* Fiber.join(ready);

    assert.strictEqual(attempts, 22);
  }),
);
