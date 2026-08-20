import type { Schema } from "effect";
import type { TrailResults } from "./index.ts";

/**
 * A collecting metric that buffers all deltas before computing.
 *
 * Waits for all trail results to be collected, then computes a single output.
 * The metric only emits once the stream completes.
 *
 * @param results - All collected trail results.
 * @returns The metric output.
 */
export type Exec<G = unknown, R extends Schema.Json = Schema.Json> = (
  results: TrailResults<G>,
) => R | Promise<R>;

export type Options<G = unknown, R extends Schema.Json = Schema.Json> = Readonly<{
  exec: Exec<G, R>;
}>;
