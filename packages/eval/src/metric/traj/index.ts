import type { Prompt, Sandbox } from "@open-insight/core/internal";
import {
  Cause,
  Effect,
  Fiber,
  Queue,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  SynchronizedRef,
} from "effect";
import { Metadata, type MetadataEncoded } from "../metadata.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Chart from "#/chart/index.ts";
import { MetricError } from "../error.ts";

export type Context = Readonly<{
  prompt: Prompt.Prompt;
  response: Prompt.Parts;
  trajectory: Prompt.Trajectory;
}>;

/**
 * Computes a trajectory metric whenever its trigger matches.
 *
 * @param context The sandbox, previous trajectory, and current response parts observed so far.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<R extends Schema.Json = Schema.Json> = (
  context: Context,
  prev: R | null,
) => R | Promise<R>;

export type When = (context: Context) => boolean;

export type Metric<R extends Schema.Json = Schema.Json> = Readonly<{
  metadata: Metadata;
  exec: BivariantFn<Exec<R>>;

  when: When | null;
  chart: BivariantFn<Chart.Chart<R>> | null;
}>;

export type Options<R extends Schema.Json = Schema.Json> = Readonly<{
  exec: Exec<R>;
  when?: When;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.Json = Schema.Json>(options: Options<R>) {
  const { exec, when = null, chart = null } = options;

  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return {
    metadata,
    exec,
    when,
    chart,
  } satisfies Metric<R>;
});

export const register = Effect.fn(function* ({
  metric: { exec, when, metadata },
  sandbox: _sandbox,
  contextRef,
  enqueue,
}: {
  metric: Metric;
  sandbox: Sandbox.Sandbox;
  contextRef: SubscriptionRef.SubscriptionRef<Context>;
  enqueue: Queue.Enqueue<Schema.Json, MetricError | Cause.Done>;
}): Effect.fn.Return<Fiber.Fiber<void, MetricError>, MetricError, Scope.Scope> {
  const prevRef = yield* SynchronizedRef.make<Schema.Json | null>(null);

  const run = Effect.fn(function* (context: Context) {
    if (when !== null && !when(context)) {
      return;
    }

    const next = yield* prevRef.pipe(
      SynchronizedRef.getAndUpdateEffect((prev) =>
        Effect.tryPromise({
          try: () => Promise.resolve(exec(context, prev)),
          catch: MetricError.exec(metadata.id),
        }),
      ),
    );

    yield* Queue.offer(enqueue, next);
  });

  return yield* SubscriptionRef.changes(contextRef)
    .pipe(Stream.runForEach(run))
    .pipe(Effect.ensuring(Queue.end(enqueue)))
    .pipe(Effect.forkScoped);
});
