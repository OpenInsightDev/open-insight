import { Effect, Option, Queue, Scope, Stream, Crypto } from "effect";
import * as Event from "#/event/index.ts";
import { type Config, make as makeConfig } from "./config.ts";
import * as Bench from "#/bench/index.ts";
import { Harness } from "@open-insight/core/internal";
import { run as runSchedule } from "./schedule.ts";
import type { BenchResult } from "./result.ts";
import { NodeServices } from "@effect/platform-node";
import { Error } from "./error.ts";

type Options = Readonly<{
  bench: Bench.Bench;
  harnessId: string;
  config?: Partial<Config>;
}>;

export const run = Effect.fn(function* ({
  bench,
  harnessId,
  config: configOptions = {},
}: Options): Effect.fn.Return<BenchResult, Error, Crypto.Crypto | Harness.HarnessServices> {
  const config = makeConfig(configOptions);
  const transport = yield* Effect.serviceOption(Event.Transport.Service);
  const eventQueue = yield* Event.makeQueue();
  const eventStream = Stream.fromQueue(eventQueue);

  const consume = transport.pipe(
    Option.match({
      onNone: () => Stream.runDrain(eventStream).pipe(Effect.mapError(Error.event)),
      onSome: (transport) =>
        transport.send(eventStream).pipe(Effect.mapError(Error.event), Effect.scoped),
    }),
  );

  return yield* Effect.zipWith(
    runSchedule({ bench, harnessId, eventQueue }, config).pipe(
      Effect.ensuring(Queue.end(eventQueue)),
    ),
    consume,
    (result) => result,
    { concurrent: true },
  ).pipe(Effect.provide(NodeServices.layer));
});

export const toPromise = <T, E>(
  effect: Effect.Effect<T, E, NodeServices.NodeServices | Scope.Scope>,
) => Effect.runPromise(effect.pipe(Effect.scoped).pipe(Effect.provide(NodeServices.layer)));
