import { DateTime, Effect, Queue, Stream } from "effect";
import * as Chart from "#/chart/index.ts";
import { Sandbox } from "@open-insight/core/internal";
import type { MetricError } from "../error.ts";
import type { Metadata } from "../schema.ts";

/** Creates a stream of timestamps by repeating the current time with the given options. */
export const fromRepeat = (
  repeat: Effect.Repeat.Options<unknown>,
): Stream.Stream<DateTime.DateTime, unknown> =>
  Stream.callback<DateTime.DateTime, unknown>((queue) =>
    DateTime.now.pipe(
      Effect.tap((date) => Queue.offer(queue, date)),
      Effect.repeat(repeat),
      Effect.asVoid,
    ),
  );

export type Metric = Readonly<{
  metadata: Metadata;
  repeat: Effect.Repeat.Options<unknown>;
  transform: (
    context: Readonly<{
      sandbox: Sandbox.ReadonlySandbox;
      stream: Stream.Stream<DateTime.DateTime, unknown>;
    }>,
  ) => Stream.Stream<Chart.Points, MetricError>;
}>;
