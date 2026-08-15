import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Sandbox } from "@open-insight/core/internal";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { Cause, Effect, Fiber, Queue, Schedule, Schema, Scope, SynchronizedRef } from "effect";
import { MetricError } from "../error.ts";

export type Exec<R extends Schema.Json = Schema.Json> = (
  sandbox: Sandbox.ReadonlySandboxPromise,
  prev: R | null,
) => R | Promise<R>;

export type Repeat = Schedule.Schedule<unknown>;

export type Metric<R extends Schema.Json = Schema.Json> = Readonly<{
  metadata: Metadata;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  repeat: Effect.Repeat.Options<unknown>;
  retry: Effect.Retry.Options<unknown>;
}>;

export type Options<R extends Schema.Json = Schema.Json> = Effect.Repeat.Options<unknown> &
  Readonly<{
    exec: Exec<R>;
    retry?: Effect.Retry.Options<unknown>;
    chart?: Chart.Chart<R> | null;
  }> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.Json = Schema.Json>(
  options: Options<R>,
): Effect.fn.Return<Metric<R>, MetricError> {
  const { exec, retry = {}, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return {
    metadata,
    exec,
    chart,
    repeat: options,
    retry,
  } satisfies Metric<R>;
});

export const register = ({
  sandbox,
  enqueue,
}: {
  sandbox: Sandbox.Sandbox;
  enqueue: Queue.Enqueue<Result, MetricError | Cause.Done>;
}) =>
  Effect.fn(function* ({
    exec,
    repeat,
    retry,
    metadata,
    chart,
  }: Metric): Effect.fn.Return<Fiber.Fiber<Schema.Json, MetricError>, MetricError, Scope.Scope> {
    const sbxPromise = yield* Sandbox.asPromise(sandbox).pipe(Effect.mapError(MetricError.sandbox));

    const prevRef = yield* SynchronizedRef.make<Schema.Json | null>(null);

    const run = Effect.fn(function* (prev: Schema.Json | null) {
      const next = yield* Effect.tryPromise({
        try: () => Promise.resolve(exec(sbxPromise, prev)),
        catch: MetricError.exec(metadata.id),
      }).pipe(Effect.retry(retry));

      yield* Queue.offer(
        enqueue,
        Result.make({
          id: metadata.id,
          value: next,
          chart: chart?.(next) ?? null,
        }),
      );

      return next;
    });

    return yield* prevRef
      .pipe(SynchronizedRef.getAndUpdateEffect(run))
      .pipe(Effect.repeat(repeat))
      .pipe(Effect.ensuring(Queue.end(enqueue)))
      .pipe(Effect.forkScoped);
  });
