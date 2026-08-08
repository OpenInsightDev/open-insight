import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import * as Prompt from "#/prompt/index.ts";
import { make } from "./service.ts";

const textParts = (text: string): ReadonlyArray<Response.StreamPartEncoded> => [
  { type: "text-start", id: "t" } as Response.StreamPartEncoded,
  { type: "text-delta", id: "t", delta: text } as Response.StreamPartEncoded,
  { type: "text-end", id: "t" } as Response.StreamPartEncoded,
];

/**
 * Concurrent `prompt` calls on the same agent must be serialized: the second
 * model invocation only runs after the first has fully committed its turn into
 * the history, so neither prompt nor response is lost and the second call sees
 * the first in its context.
 */
it.effect("serializes concurrent prompt calls so the trajectory accumulates atomically", () =>
  Effect.gen(function* () {
    // Signals that the first call is running (holding the agent lock).
    const started = yield* Deferred.make<void>();
    // Released by the test to let the first call finish its turn.
    const proceed = yield* Deferred.make<void>();

    const agent = yield* make((trajectory) => {
      const isFirst = trajectory.content.every((message) => message.role !== "assistant");
      const stream = Stream.fromIterable(textParts(isFirst ? "first" : "second"));
      // The first call signals it is streaming (holding the lock) and then blocks
      // inside the model stream until `proceed` — without emitting a part — so
      // the lock stays held while the second call queues behind it.
      if (isFirst) {
        return Stream.unwrap(
          Deferred.succeed(started, void 0).pipe(
            Effect.flatMap(() => Deferred.await(proceed)),
            Effect.map(() => stream),
          ),
        );
      }
      return stream;
    });

    // Kick off the first call and wait until it has acquired the lock and is
    // streaming, then start the second (which must queue behind it).
    const fiber = yield* Effect.forkChild(agent.prompt(Prompt.make("first")).pipe(Stream.runDrain));
    yield* Deferred.await(started);
    const second = yield* Effect.forkChild(
      agent.prompt(Prompt.make("second")).pipe(Stream.runDrain),
    );

    // Let the first call finish its turn.
    yield* Deferred.succeed(proceed, void 0);

    yield* Fiber.join(fiber);
    yield* Fiber.join(second);

    const history = yield* Ref.get(agent.trajectory);
    assert.deepStrictEqual(
      history.content.map((message) => message.role),
      ["user", "assistant", "user", "assistant"],
    );
    assert.deepStrictEqual(
      history.content
        .filter((message) => message.role === "assistant")
        .map(
          (message) => (message.content as ReadonlyArray<{ type: string; text?: string }>)[0]?.text,
        ),
      ["first", "second"],
    );
  }),
);
