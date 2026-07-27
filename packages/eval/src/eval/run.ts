import { Effect, Option, Queue, Scope, Stream } from "effect";
import * as Event from "#/event/index.ts";
import { type Config, make as makeConfig } from "./config.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import { run as runSchedule } from "./schedule.ts";
import type { BenchResult } from "./result.ts";
import { NodeServices } from "@effect/platform-node";
import { Error } from "./error.ts";
import { Spawn } from "@open-insight/core/utils";

type Options = Readonly<{
  bench: Bench.Bench;
  harness: Harness.Harness;
  config?: Partial<Config>;
}>;

export const run = Effect.fn(function* ({
  bench,
  harness,
  config = {},
}: Options): Effect.fn.Return<BenchResult, Error, never> {
  const resolvedConfig = makeConfig(config);
  const transport = yield* Effect.serviceOption(Event.EventTransportService);
  const eventQueue = yield* Event.makeQueue();
  const eventStream = Stream.fromQueue(eventQueue);
  const evaluation = runSchedule({ bench, harness, eventQueue }, resolvedConfig).pipe(
    Effect.provide(NodeServices.layer),
  );
  const consume = transport.pipe(
    Option.match({
      onNone: () => Stream.runDrain(eventStream).pipe(Effect.mapError(Error.event)),
      onSome: (transport) =>
        transport.send(eventStream).pipe(Effect.mapError(Error.event), Effect.scoped),
    }),
  );

  const [result] = yield* Effect.all(
    [evaluation.pipe(Effect.ensuring(Queue.end(eventQueue))), consume],
    { concurrency: "unbounded" },
  );
  return result;
});

export const toPromise = <T, E>(
  effect: Effect.Effect<T, E, NodeServices.NodeServices | Spawn.Service | Scope.Scope>,
) =>
  Effect.runPromise(
    effect
      .pipe(Effect.scoped)
      .pipe(Effect.provide(Spawn.Service.layer))
      .pipe(Effect.provide(NodeServices.layer)),
  );
