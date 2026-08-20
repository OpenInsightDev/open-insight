import type { Schema } from "effect";
import type { TrailResult } from "./index.ts";

/**
 * An accumulating metric that maintains state across calls.
 *
 * Each delta updates the state and produces an output. The state is passed
 * from one call to the next, enabling running calculations.
 *
 * @param delta - The current trail result to process.
 * @param state - The accumulated state from previous calls.
 * @returns A tuple of [output, nextState].
 */
export type Exec<G = unknown, R extends Schema.Json = Schema.Json, S = unknown> = (
  delta: TrailResult<G>,
  state: S,
) => readonly [output: R, state: S] | Promise<readonly [output: R, state: S]>;

export type Options<G = unknown, R extends Schema.Json = Schema.Json, S = unknown> = Readonly<{
  exec: Exec<G, R, S>;
  initialState: S;
}>;
