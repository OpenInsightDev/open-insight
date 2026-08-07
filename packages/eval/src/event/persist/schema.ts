import { Effect, type Scope } from "effect";
import type { EventError } from "../error.ts";
import type { EventStream } from "../queue.ts";

/**
 * A sink that durably persists every event of an evaluation run's event
 * stream to local storage (e.g. SQLite).
 *
 * The contract mirrors `Transport` so it can consume the same `EventStream`
 * produced by a run, but its destination is local storage rather than a remote
 * consumer.
 */
export type Persist = Readonly<{
  /**
   * Persists every event of the stream to local storage.
   *
   * The effect completes once the entire stream has been consumed and written.
   */
  send(stream: EventStream): Effect.Effect<void, EventError, Scope.Scope>;
}>;
