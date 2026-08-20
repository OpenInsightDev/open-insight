import type { Schema } from "effect";
import type { TrailResult } from "./index.ts";

/**
 * A map metric that processes each delta independently.
 *
 * Each trail result maps to exactly one output. No state is shared between calls.
 *
 * @param delta - The current trail result to process.
 * @returns The metric output for this delta.
 */
export type Exec<G = unknown, R extends Schema.Json = Schema.Json> = (
  delta: TrailResult<G>,
) => R | Promise<R>;

export type Options<G = unknown, R extends Schema.Json = Schema.Json> = Readonly<{
  exec: Exec<G, R>;
}>;
