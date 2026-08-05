import { Console, Layer, Stream } from "effect";
import { Service as TransportService } from "#/event/transport/service.ts";
import type { Event } from "#/event/schema.ts";
import type { Transport } from "#/event/transport/schema.ts";

export interface Options {
  /**
   * Renders an event for display. Defaults to pretty-printed JSON, falling
   * back to `String(value)` when a payload does not serialize (e.g. cyclic
   * agent stream parts).
   */
  readonly format?: (event: Event) => string;
}

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * Delivers every event of the stream to the console. Useful for live
 * observation of an evaluation run: each event is printed as it is
 * published, before `Eval.run` aggregates the final result.
 */
export const make = (options: Options = {}): Transport => {
  const format = options.format ?? stringify;

  return {
    send: (stream) =>
      stream.pipe(
        Stream.tap((event) => Console.log(format(event))),
        Stream.runDrain,
      ),
  } satisfies Transport;
};

/** Provides the evaluator's event transport with a console sink. */
export const layer = (options: Options = {}): Layer.Layer<TransportService> =>
  Layer.succeed(TransportService)(make(options));
